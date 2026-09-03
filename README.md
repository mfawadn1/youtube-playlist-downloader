# 🎬 StreamVault - YouTube & Playlist Downloader Web UI

A modern, fast, and feature-packed local web application to download YouTube videos, playlists, and audio with customizable quality and live real-time progress.

---

## ✨ Features

- **🎨 Modern Dark Glassmorphic UI**: High-tech aesthetic with responsive controls and dynamic animations.
- **⚡ Multiple Quality Presets**: Download in 4K (2160p), 2K (1440p), 1080p FHD, 720p HD, 480p, 360p, or Best Available.
- **🎵 Audio Extraction**: Convert videos or playlists to MP3, M4A, WAV, or FLAC with custom bitrates (320kbps, 256kbps, 192kbps, 128kbps).
- **📋 Playlist Selector**: Inspect entire playlists and cherry-pick specific videos with individual checkboxes or "Select All".
- **📊 Real-time WebSocket Progress**: Live download speed (MB/s), percentage %, ETA countdown, and file sizes.
- **📁 Custom Output Directory**: Choose your save location (defaults to `D:\yt downlaods`) with one-click "Open Folder" in Windows Explorer.
- **🚀 Zero Cloud Timeouts**: Runs on your local connection using `yt-dlp` and `imageio-ffmpeg`.

---

## 🛠️ Installation & Setup

1. **Install Dependencies** (if not already installed):
   ```bash
   pip install -r requirements.txt
   ```

2. **Run the Application**:
   - Double-click `run_ui.bat`  
   **OR**
   - Run via terminal:
     ```bash
     python app.py
     ```

3. The web dashboard will automatically open in your browser at:
   ```
   http://127.0.0.1:8000
   ```

---

## 📋 Technology Stack

- **Backend**: FastAPI, Uvicorn, WebSockets, Python 3.12
- **Downloader Core**: `yt-dlp` & `imageio-ffmpeg`
- **Frontend**: HTML5, Vanilla CSS3 (Glassmorphism & CSS Grid/Flexbox), Vanilla JavaScript (WebSockets & REST API)
