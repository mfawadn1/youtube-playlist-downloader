import imageio_ffmpeg
import yt_dlp

playlist_url = input("Enter YouTube playlist URL: ")

options = {
    "format": "bestvideo[height<=720]+bestaudio/best[height<=720]/best",
    "outtmpl": r"D:/yt downlaods/%(playlist_title,playlist)s/%(playlist_index)s - %(title)s.%(ext)s",
    "merge_output_format": "mp4",
    "ffmpeg_location": imageio_ffmpeg.get_ffmpeg_exe(),
    "ignoreerrors": True,
    "noplaylist": False,
    "windowsfilenames": True,
    "extractor_args": {
        "youtube": {
            "player_client": ["android", "ios", "web"]
        }
    },
}

with yt_dlp.YoutubeDL(options) as ydl:
    ydl.download([playlist_url.strip()])

print("Playlist download completed!")