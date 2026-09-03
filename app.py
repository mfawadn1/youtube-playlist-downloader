import os
import sys
import json
import asyncio
import threading
import subprocess
import webbrowser
from typing import List, Optional, Dict, Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import yt_dlp
import imageio_ffmpeg
import uvicorn

app = FastAPI(title="YouTube Downloader Web UI")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Active WebSocket connections
active_connections: List[WebSocket] = []
lock = threading.Lock()

# Current download status and cancel flags
current_task = {
    "is_downloading": False,
    "cancel_requested": False,
    "last_progress": {}
}


class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, data: dict):
        for connection in list(self.active_connections):
            try:
                await connection.send_json(data)
            except Exception:
                self.disconnect(connection)


manager = ConnectionManager()
loop: Optional[asyncio.AbstractEventLoop] = None


def send_progress_sync(data: dict):
    """Bridge sync threads to asyncio websocket broadcaster"""
    global loop
    if loop and loop.is_running():
        asyncio.run_coroutine_threadsafe(manager.broadcast(data), loop)


class AnalyzeRequest(BaseModel):
    url: str


class DownloadRequest(BaseModel):
    url: str
    mode: str = "video_audio"  # "video_audio", "audio_only", "video_only"
    quality: str = "720"  # "best", "2160", "1440", "1080", "720", "480", "360"
    video_format: str = "mp4"  # "mp4", "mkv"
    audio_format: str = "mp3"  # "mp3", "m4a", "wav", "flac"
    audio_quality: str = "192"  # "320", "256", "192", "128"
    output_dir: str = r"D:\yt downlaods"
    selected_indices: Optional[List[int]] = None  # 1-indexed playlist item indices


class OpenFolderRequest(BaseModel):
    path: str


@app.get("/api/health")
def health_check():
    return {
        "status": "ok",
        "ffmpeg": imageio_ffmpeg.get_ffmpeg_exe(),
        "is_downloading": current_task["is_downloading"]
    }


@app.post("/api/analyze")
def analyze_url(req: AnalyzeRequest):
    url = req.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="URL cannot be empty")

    ydl_opts = {
        "extract_flat": "in_playlist",
        "skip_download": True,
        "ignoreerrors": True,
        "quiet": True,
        "no_warnings": True,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if not info:
                raise HTTPException(status_code=404, detail="Could not extract video or playlist info")

            is_playlist = info.get("_type") == "playlist" or "entries" in info

            if is_playlist:
                raw_entries = info.get("entries", [])
                entries = []
                idx = 1
                for item in raw_entries:
                    if item:
                        entries.append({
                            "index": idx,
                            "id": item.get("id"),
                            "title": item.get("title", f"Video {idx}"),
                            "duration": item.get("duration", 0),
                            "duration_string": item.get("duration_string", ""),
                            "url": item.get("url") or f"https://www.youtube.com/watch?v={item.get('id')}",
                            "thumbnail": item.get("thumbnail") or (item.get("thumbnails", [{}])[-1].get("url") if item.get("thumbnails") else None),
                            "uploader": item.get("uploader", item.get("channel", "Unknown")),
                        })
                        idx += 1

                # Try to get best thumbnail for playlist
                playlist_thumb = info.get("thumbnail")
                if not playlist_thumb and entries:
                    playlist_thumb = entries[0]["thumbnail"]

                return {
                    "is_playlist": True,
                    "id": info.get("id"),
                    "title": info.get("title", "YouTube Playlist"),
                    "uploader": info.get("uploader") or info.get("channel") or "Unknown Channel",
                    "thumbnail": playlist_thumb,
                    "item_count": len(entries),
                    "entries": entries,
                }
            else:
                # Single video - get available resolutions
                formats = info.get("formats", [])
                heights = set()
                for f in formats:
                    h = f.get("height")
                    if h and isinstance(h, int) and h >= 144:
                        heights.add(h)
                sorted_heights = sorted(list(heights), reverse=True)

                return {
                    "is_playlist": False,
                    "id": info.get("id"),
                    "title": info.get("title", "YouTube Video"),
                    "uploader": info.get("uploader") or info.get("channel") or "Unknown Channel",
                    "duration": info.get("duration", 0),
                    "duration_string": info.get("duration_string", ""),
                    "thumbnail": info.get("thumbnail") or (info.get("thumbnails", [{}])[-1].get("url") if info.get("thumbnails") else None),
                    "view_count": info.get("view_count"),
                    "available_resolutions": sorted_heights or [1080, 720, 480, 360],
                }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error analyzing URL: {str(e)}")


def run_download_thread(req: DownloadRequest):
    global current_task
    current_task["is_downloading"] = True
    current_task["cancel_requested"] = False

    output_dir = os.path.abspath(req.output_dir.strip())
    os.makedirs(output_dir, exist_ok=True)

    # Determine format and options
    ffmpeg_path = imageio_ffmpeg.get_ffmpeg_exe()
    
    ydl_opts: Dict[str, Any] = {
        "ffmpeg_location": ffmpeg_path,
        "ignoreerrors": True,
        "windowsfilenames": True,
        "noplaylist": False,
    }

    # Template setup
    # If downloading items, template will put playlist in subfolder if applicable
    ydl_opts["outtmpl"] = os.path.join(
        output_dir,
        "%(playlist_title,playlist)s/%(playlist_index)02d - %(title)s.%(ext)s" if "%(playlist" in req.url or "list=" in req.url else "%(title)s.%(ext)s"
    )

    if req.selected_indices:
        # 1-indexed playlist items
        indices_str = ",".join(str(i) for i in req.selected_indices)
        ydl_opts["playlist_items"] = indices_str

    if req.mode == "audio_only":
        ydl_opts["format"] = "ba/bestaudio/best"
        ydl_opts["postprocessors"] = [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": req.audio_format,
            "preferredquality": req.audio_quality,
        }]
    elif req.mode == "video_only":
        if req.quality == "best":
            ydl_opts["format"] = "bv*/bestvideo/best"
        else:
            ydl_opts["format"] = f"bv*[height<={req.quality}]/bestvideo[height<={req.quality}]/best"
        ydl_opts["merge_output_format"] = req.video_format
    else:  # video_audio
        if req.quality == "best":
            ydl_opts["format"] = "bv*+ba/b"
        else:
            ydl_opts["format"] = f"bv*[height<={req.quality}]+ba/b[height<={req.quality}]/best[height<={req.quality}]/best"
        ydl_opts["merge_output_format"] = req.video_format

    def progress_hook(d):
        if current_task["cancel_requested"]:
            raise Exception("Download cancelled by user")

        status = d.get("status")
        if status == "downloading":
            total_bytes = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            downloaded = d.get("downloaded_bytes") or 0
            percent = 0.0
            if total_bytes > 0:
                percent = round((downloaded / total_bytes) * 100, 1)

            speed = d.get("speed") or 0
            speed_str = f"{round(speed / (1024 * 1024), 2)} MB/s" if speed else "Calculating..."
            
            eta = d.get("eta") or 0
            eta_str = f"{eta // 60:02d}:{eta % 60:02d}" if eta else "--:--"

            filename = os.path.basename(d.get("filename", ""))
            
            payload = {
                "type": "progress",
                "status": "downloading",
                "percent": percent,
                "downloaded_bytes": downloaded,
                "total_bytes": total_bytes,
                "speed": speed_str,
                "eta": eta_str,
                "filename": filename,
                "playlist_index": d.get("info_dict", {}).get("playlist_index"),
                "n_entries": d.get("info_dict", {}).get("n_entries"),
            }
            send_progress_sync(payload)

        elif status == "finished":
            payload = {
                "type": "progress",
                "status": "processing",
                "filename": os.path.basename(d.get("filename", "")),
                "message": "Merging / post-processing audio and video..."
            }
            send_progress_sync(payload)

    ydl_opts["progress_hooks"] = [progress_hook]

    send_progress_sync({
        "type": "status",
        "status": "started",
        "message": "Starting download task..."
    })

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([req.url.strip()])

        send_progress_sync({
            "type": "status",
            "status": "completed",
            "message": "All downloads completed successfully!",
            "output_dir": output_dir
        })
    except Exception as e:
        msg = str(e)
        if "cancelled" in msg.lower():
            send_progress_sync({
                "type": "status",
                "status": "cancelled",
                "message": "Download was cancelled."
            })
        else:
            send_progress_sync({
                "type": "status",
                "status": "error",
                "message": f"Download failed: {msg}"
            })
    finally:
        current_task["is_downloading"] = False


@app.post("/api/download")
def start_download(req: DownloadRequest):
    global current_task
    if current_task["is_downloading"]:
        raise HTTPException(status_code=409, detail="A download task is already in progress.")

    thread = threading.Thread(target=run_download_thread, args=(req,), daemon=True)
    thread.start()
    return {"status": "started", "message": "Download initiated"}


@app.post("/api/cancel")
def cancel_download():
    global current_task
    if not current_task["is_downloading"]:
        return {"status": "idle", "message": "No active download to cancel."}
    current_task["cancel_requested"] = True
    return {"status": "cancelling", "message": "Cancellation requested."}


@app.post("/api/browse-folder")
def browse_folder():
    def _pick():
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        selected = filedialog.askdirectory(title="Select Download Destination Folder")
        root.destroy()
        return selected

    try:
        folder = _pick()
        if folder:
            folder = os.path.normpath(folder)
            return {"status": "ok", "path": folder}
        return {"status": "cancelled", "path": None}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not open folder picker: {str(e)}")


@app.get("/api/quick-folders")
def get_quick_folders():
    user_home = os.path.expanduser("~")
    folders = [
        {"name": "D:\\yt downlaods", "path": r"D:\yt downlaods"},
        {"name": "Downloads", "path": os.path.normpath(os.path.join(user_home, "Downloads"))},
        {"name": "Videos", "path": os.path.normpath(os.path.join(user_home, "Videos"))},
        {"name": "Desktop", "path": os.path.normpath(os.path.join(user_home, "Desktop"))},
    ]
    return {"folders": folders}


@app.post("/api/open-folder")
def open_folder(req: OpenFolderRequest):
    folder_path = os.path.abspath(req.path.strip())
    if not os.path.exists(folder_path):
        os.makedirs(folder_path, exist_ok=True)

    try:
        if sys.platform == "win32":
            os.startfile(folder_path)
        elif sys.platform == "darwin":
            subprocess.Popen(["open", folder_path])
        else:
            subprocess.Popen(["xdg-open", folder_path])
        return {"status": "ok", "message": f"Opened {folder_path}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not open folder: {str(e)}")


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Keep alive and receive any client ping
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)


# Mount static files
static_dir = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(static_dir, exist_ok=True)
app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")


def main():
    global loop
    print("=" * 60)
    print("  YouTube Playlist & Video Downloader - Web Dashboard")
    print("  Server running at: http://127.0.0.1:8000")
    print("=" * 60)

    # Auto open browser
    threading.Timer(1.2, lambda: webbrowser.open("http://127.0.0.1:8000")).start()

    config = uvicorn.Config(app, host="127.0.0.1", port=8000, log_level="info")
    server = uvicorn.Server(config)
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(server.serve())


if __name__ == "__main__":
    main()
