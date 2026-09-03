// State
let analyzedData = null;
let currentMode = "video_audio";
let selectedQuality = "1080";
let selectedAudioFmt = "mp3";
let selectedAudioQuality = "320";
let ws = null;
let selectedIndices = new Set();

// Elements
const urlInput = document.getElementById("urlInput");
const pasteBtn = document.getElementById("pasteBtn");
const analyzeBtn = document.getElementById("analyzeBtn");
const analyzeSpinner = document.getElementById("analyzeSpinner");
const wsStatus = document.getElementById("wsStatus");

const previewCard = document.getElementById("previewCard");
const mediaThumbnail = document.getElementById("mediaThumbnail");
const mediaDuration = document.getElementById("mediaDuration");
const mediaTypeTag = document.getElementById("mediaTypeTag");
const mediaUploader = document.getElementById("mediaUploader");
const mediaTitle = document.getElementById("mediaTitle");
const mediaSubtitle = document.getElementById("mediaSubtitle");

const optionsCard = document.getElementById("optionsCard");
const modeTabs = document.querySelectorAll(".mode-tab");
const videoQualityGroup = document.getElementById("videoQualityGroup");
const audioSettingsGroup = document.getElementById("audioSettingsGroup");
const qualityPillsContainer = document.getElementById("qualityPills");
const audioFormatPills = document.querySelectorAll("#audioFormatPills .pill-btn");
const audioBitratePills = document.querySelectorAll("#audioBitratePills .pill-btn");
const outputDirInput = document.getElementById("outputDirInput");
const openFolderBtn = document.getElementById("openFolderBtn");

const playlistSection = document.getElementById("playlistSection");
const playlistTableBody = document.getElementById("playlistTableBody");
const playlistSelectionCount = document.getElementById("playlistSelectionCount");
const headerCheckbox = document.getElementById("headerCheckbox");
const selectAllBtn = document.getElementById("selectAllBtn");
const deselectAllBtn = document.getElementById("deselectAllBtn");

const startDownloadBtn = document.getElementById("startDownloadBtn");

const progressCard = document.getElementById("progressCard");
const progressTitle = document.getElementById("progressTitle");
const currentFilename = document.getElementById("currentFilename");
const progressFill = document.getElementById("progressFill");
const percentVal = document.getElementById("percentVal");
const speedVal = document.getElementById("speedVal");
const etaVal = document.getElementById("etaVal");
const sizeVal = document.getElementById("sizeVal");
const cancelBtn = document.getElementById("cancelBtn");
const completionBanner = document.getElementById("completionBanner");
const openCompleteFolderBtn = document.getElementById("openCompleteFolderBtn");
const pulseIndicator = document.getElementById("pulseIndicator");

// WebSocket Connection
function connectWebSocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    wsStatus.className = "server-status";
    wsStatus.innerHTML = `<span class="status-dot"></span><span class="status-text">Connected</span>`;
  };

  ws.onclose = () => {
    wsStatus.className = "server-status disconnected";
    wsStatus.innerHTML = `<span class="status-dot"></span><span class="status-text">Disconnected</span>`;
    setTimeout(connectWebSocket, 3000);
  };

  ws.onerror = () => {
    wsStatus.className = "server-status disconnected";
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleProgressEvent(data);
    } catch (e) {
      console.error("Error parsing WS message:", e);
    }
  };
}

function handleProgressEvent(data) {
  if (data.type === "progress") {
    if (data.status === "downloading") {
      progressFill.style.width = `${data.percent}%`;
      percentVal.textContent = `${data.percent}%`;
      speedVal.textContent = data.speed || "-- MB/s";
      etaVal.textContent = data.eta || "--:--";

      const dlMB = (data.downloaded_bytes / (1024 * 1024)).toFixed(1);
      const totMB = data.total_bytes ? (data.total_bytes / (1024 * 1024)).toFixed(1) : "?";
      sizeVal.textContent = `${dlMB} / ${totMB} MB`;

      if (data.filename) {
        currentFilename.textContent = data.filename;
      }
      if (data.playlist_index && data.n_entries) {
        progressTitle.textContent = `Downloading item ${data.playlist_index} of ${data.n_entries}...`;
      } else {
        progressTitle.textContent = "Downloading...";
      }
    } else if (data.status === "processing") {
      currentFilename.textContent = data.message || "Processing / Merging formats...";
      percentVal.textContent = "100%";
      progressFill.style.width = "100%";
    }
  } else if (data.type === "status") {
    if (data.status === "started") {
      progressCard.classList.remove("hidden");
      completionBanner.classList.add("hidden");
      cancelBtn.classList.remove("hidden");
      progressTitle.textContent = "Starting download...";
      currentFilename.textContent = "Contacting YouTube...";
      progressFill.style.width = "0%";
      percentVal.textContent = "0%";
      speedVal.textContent = "-- MB/s";
      etaVal.textContent = "--:--";
      sizeVal.textContent = "-- / --";
      pulseIndicator.style.background = "var(--secondary)";
    } else if (data.status === "completed") {
      progressTitle.textContent = "Download Finished!";
      currentFilename.textContent = data.message || "All files downloaded.";
      progressFill.style.width = "100%";
      percentVal.textContent = "100%";
      cancelBtn.classList.add("hidden");
      completionBanner.classList.remove("hidden");
      pulseIndicator.style.background = "var(--success)";
      startDownloadBtn.disabled = false;
    } else if (data.status === "cancelled") {
      progressTitle.textContent = "Download Cancelled";
      currentFilename.textContent = "Task stopped by user.";
      cancelBtn.classList.add("hidden");
      pulseIndicator.style.background = "var(--warning)";
      startDownloadBtn.disabled = false;
    } else if (data.status === "error") {
      progressTitle.textContent = "Download Failed";
      currentFilename.textContent = data.message;
      cancelBtn.classList.add("hidden");
      pulseIndicator.style.background = "var(--danger)";
      startDownloadBtn.disabled = false;
      alert(data.message);
    }
  }
}

// Paste button
pasteBtn.addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      urlInput.value = text.trim();
      analyzeUrl();
    }
  } catch (err) {
    urlInput.focus();
  }
});

// Analyze on Enter key
urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    analyzeUrl();
  }
});

analyzeBtn.addEventListener("click", analyzeUrl);

async function analyzeUrl() {
  const url = urlInput.value.trim();
  if (!url) {
    alert("Please enter a YouTube video or playlist URL.");
    return;
  }

  analyzeSpinner.classList.add("active");
  analyzeBtn.querySelector(".btn-text").textContent = "Analyzing...";
  analyzeBtn.disabled = true;

  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || "Failed to analyze URL");
    }

    analyzedData = data;
    renderMediaPreview(data);
    renderOptions(data);
  } catch (err) {
    alert("Error: " + err.message);
  } finally {
    analyzeSpinner.classList.remove("active");
    analyzeBtn.querySelector(".btn-text").textContent = "Analyze Link";
    analyzeBtn.disabled = false;
  }
}

function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return "--:--";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function renderMediaPreview(data) {
  previewCard.classList.remove("hidden");
  optionsCard.classList.remove("hidden");

  mediaThumbnail.src = data.thumbnail || "https://placehold.co/600x400/111827/ffffff?text=YouTube";
  mediaTitle.textContent = data.title;
  mediaUploader.textContent = data.uploader;

  if (data.is_playlist) {
    mediaTypeTag.textContent = `Playlist (${data.item_count} videos)`;
    mediaDuration.textContent = `${data.item_count} items`;
    mediaSubtitle.textContent = `Full playlist by ${data.uploader}`;
  } else {
    mediaTypeTag.textContent = "Single Video";
    mediaDuration.textContent = data.duration_string || formatDuration(data.duration);
    mediaSubtitle.textContent = `Duration: ${data.duration_string || formatDuration(data.duration)}`;
  }
}

function renderOptions(data) {
  // Render resolution pills
  qualityPillsContainer.innerHTML = "";
  let resolutions = ["2160", "1440", "1080", "720", "480", "360", "best"];

  if (!data.is_playlist && data.available_resolutions && data.available_resolutions.length > 0) {
    const set = new Set(data.available_resolutions.map(String));
    resolutions = ["2160", "1440", "1080", "720", "480", "360"].filter(r => set.has(r));
    resolutions.push("best");
  }

  resolutions.forEach((res, index) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill-btn";
    btn.dataset.quality = res;

    let label = `${res}p`;
    if (res === "2160") label = "4K (2160p)";
    if (res === "1440") label = "2K (1440p)";
    if (res === "1080") label = "1080p FHD";
    if (res === "720") label = "720p HD";
    if (res === "best") label = "Best Available";

    btn.textContent = label;

    // Default to 1080 or 720 or first available
    if (res === "1080" || (index === 0 && !resolutions.includes("1080"))) {
      btn.classList.add("active");
      selectedQuality = res;
    }

    btn.addEventListener("click", () => {
      document.querySelectorAll("#qualityPills .pill-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      selectedQuality = res;
    });

    qualityPillsContainer.appendChild(btn);
  });

  // Handle Playlist view
  if (data.is_playlist) {
    playlistSection.classList.remove("hidden");
    selectedIndices = new Set(data.entries.map(e => e.index));
    renderPlaylistTable(data.entries);
    updateSelectionCount();
  } else {
    playlistSection.classList.add("hidden");
    selectedIndices.clear();
  }
}

function renderPlaylistTable(entries) {
  playlistTableBody.innerHTML = "";
  headerCheckbox.checked = true;

  entries.forEach((item) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="checkbox" class="item-checkbox" data-index="${item.index}" checked></td>
      <td>${item.index}</td>
      <td title="${item.title}">${item.title}</td>
      <td>${item.duration_string || formatDuration(item.duration)}</td>
    `;

    const cb = tr.querySelector(".item-checkbox");
    cb.addEventListener("change", () => {
      if (cb.checked) {
        selectedIndices.add(item.index);
      } else {
        selectedIndices.delete(item.index);
      }
      updateSelectionCount();
    });

    playlistTableBody.appendChild(tr);
  });
}

function updateSelectionCount() {
  const total = analyzedData ? analyzedData.entries.length : 0;
  playlistSelectionCount.textContent = `Selected ${selectedIndices.size} of ${total}`;
  headerCheckbox.checked = selectedIndices.size === total;
}

headerCheckbox.addEventListener("change", () => {
  const checked = headerCheckbox.checked;
  const cbs = playlistTableBody.querySelectorAll(".item-checkbox");
  cbs.forEach(cb => {
    cb.checked = checked;
    const idx = parseInt(cb.dataset.index);
    if (checked) selectedIndices.add(idx);
    else selectedIndices.delete(idx);
  });
  updateSelectionCount();
});

selectAllBtn.addEventListener("click", () => {
  headerCheckbox.checked = true;
  headerCheckbox.dispatchEvent(new Event("change"));
});

deselectAllBtn.addEventListener("click", () => {
  headerCheckbox.checked = false;
  headerCheckbox.dispatchEvent(new Event("change"));
});

// Mode Tabs
modeTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    modeTabs.forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    currentMode = tab.dataset.mode;

    if (currentMode === "audio_only") {
      videoQualityGroup.classList.add("hidden");
      audioSettingsGroup.classList.remove("hidden");
    } else {
      videoQualityGroup.classList.remove("hidden");
      audioSettingsGroup.classList.add("hidden");
    }
  });
});

// Audio pills
audioFormatPills.forEach(btn => {
  btn.addEventListener("click", () => {
    audioFormatPills.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    selectedAudioFmt = btn.dataset.audioFmt;
  });
});

audioBitratePills.forEach(btn => {
  btn.addEventListener("click", () => {
    audioBitratePills.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    selectedAudioQuality = btn.dataset.audioQuality;
  });
});

// Open folder action
async function openOutputDir(path) {
  try {
    await fetch("/api/open-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
  } catch (e) {
    console.error("Could not open folder:", e);
  }
}

openFolderBtn.addEventListener("click", () => {
  openOutputDir(outputDirInput.value);
});

openCompleteFolderBtn.addEventListener("click", () => {
  openOutputDir(outputDirInput.value);
});

// Start Download
startDownloadBtn.addEventListener("click", async () => {
  if (!analyzedData) return;

  const url = urlInput.value.trim();
  const outputDir = outputDirInput.value.trim();

  let indices = null;
  if (analyzedData.is_playlist) {
    if (selectedIndices.size === 0) {
      alert("Please select at least 1 video from the playlist to download.");
      return;
    }
    indices = Array.from(selectedIndices).sort((a, b) => a - b);
  }

  const payload = {
    url: url,
    mode: currentMode,
    quality: selectedQuality,
    video_format: "mp4",
    audio_format: selectedAudioFmt,
    audio_quality: selectedAudioQuality,
    output_dir: outputDir,
    selected_indices: indices,
  };

  startDownloadBtn.disabled = true;

  try {
    const res = await fetch("/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || "Download could not be initiated.");
    }

    progressCard.classList.remove("hidden");
    progressCard.scrollIntoView({ behavior: "smooth" });
  } catch (err) {
    alert("Error: " + err.message);
    startDownloadBtn.disabled = false;
  }
});

// Cancel Download
cancelBtn.addEventListener("click", async () => {
  try {
    await fetch("/api/cancel", { method: "POST" });
  } catch (e) {
    console.error("Cancel failed:", e);
  }
});

// Initialize WebSocket
connectWebSocket();
