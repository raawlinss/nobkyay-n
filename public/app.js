"use strict";

/* ─── State ─── */
const S = {
  role: null,
  ws: null,
  pc: null,
  hls: null,
  mode: "webrtc",
  nick: localStorage.getItem("nobk_nick") || "",
  liveAt: null,
  streamKey: null,
  isLive: false,
  retryTimer: null,
  hlsOrigin: null,   // populated from /api/config
  whepSessionUrl: null,
  playbackAttempt: 0,
};

/* ─── DOM ─── */
const $ = id => document.getElementById(id);
const els = {};

const ICE = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
  ]
};

/* ─── Boot ─── */
document.addEventListener("DOMContentLoaded", () => {
  els.appShell = $("appShell");
  els.viewerVideo = $("viewerVideo");
  els.emptyState = $("emptyState");
  els.emptySubtext = $("emptySubtext");
  els.livePill = $("livePill");
  els.modePill = $("modePill");
  els.qualityPill = $("qualityPill");
  els.status = $("connectionStatus");
  els.muteBtn = $("muteButton");
  els.fsBtn = $("fullscreenButton");
  els.viewerCount = $("viewerCount");
  els.liveTimer = $("liveTimer");
  els.nickGate = $("nickGate");
  els.nickForm = $("nickForm");
  els.nickInput = $("nickInput");
  els.skGate = $("streamKeyGate");
  els.skForm = $("streamKeyForm");
  els.skInput = $("streamKeyInput");
  els.skError = $("keyError");
  els.adminOverlay = $("adminOverlay");
  els.twitchChat = $("twitchChatFrame");
  els.cinemaBtn = $("cinemaButton");
  els.panelDragHandle = $("panelDragHandle");
  els.minimizeBtn = $("minimizePanelBtn");
  els.sourcePanel = $("sourcePanel");
  els.modeToggle = $("modeToggle");

  // Twitch chat embed
  if (els.twitchChat) {
    const hostname = location.hostname;
    const parents = [hostname];
    if (hostname.endsWith('.hf.space')) parents.push('huggingface.co');
    if (hostname.endsWith('.onrender.com')) parents.push('onrender.com');
    const parentParams = parents.map(p => `parent=${p}`).join('&');
    els.twitchChat.src = `https://www.twitch.tv/embed/nobk/chat?${parentParams}&darkpopout`;
  }

  bindUI();
  detectRole();
  connectChat();
  startTimer();
  connectWebSocket();
  pollStreamStatus();
});

function detectRole() {
  const hash = location.hash;
  if (hash === "#nobk-raw" || hash === "#broadcaster" || hash === "#admin") {
    showStreamKeyGate();
  } else {
    showNickGate();
  }
}

/* ─── Nick Gate ─── */
function showNickGate() {
  if (S.nick) { els.nickGate.classList.add("is-hidden"); return; }
  els.nickGate.classList.remove("is-hidden");
  setTimeout(() => els.nickInput.focus(), 80);
}

/* ─── Stream Key Gate ─── */
function showStreamKeyGate() {
  els.nickGate.classList.add("is-hidden");
  els.skGate.removeAttribute("hidden");
  setTimeout(() => els.skInput.focus(), 80);
}

/* ─── Bind UI ─── */
function bindUI() {
  els.nickForm.addEventListener("submit", e => {
    e.preventDefault();
    const nick = cleanNick(els.nickInput.value);
    if (nick.length < 2) { els.nickInput.focus(); return; }
    if (nick === "NOBK-RAW") { showStreamKeyGate(); return; }
    S.nick = nick;
    localStorage.setItem("nobk_nick", nick);
    els.nickGate.classList.add("is-hidden");
  });

  els.skForm.addEventListener("submit", async e => {
    e.preventDefault();
    const key = els.skInput.value.trim();
    if (!key) return;
    try {
      const r = await fetch("/api/auth/stream-key", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const d = await r.json();
      if (d.ok) {
        S.streamKey = key;
        S.role = "admin";
        els.skGate.setAttribute("hidden", "");
        els.skError.setAttribute("hidden", "");
        els.nickGate.classList.add("is-hidden");
        showAdminPanel();
      } else {
        els.skError.removeAttribute("hidden");
        els.skInput.value = "";
        els.skInput.focus();
      }
    } catch { els.skError.removeAttribute("hidden"); }
  });

  // Mute toggle
  els.muteBtn.addEventListener("click", () => {
    const v = els.viewerVideo;
    v.muted = !v.muted;
    els.muteBtn.textContent = v.muted ? "🔇" : "🔊";
  });

  // Fullscreen
  els.fsBtn.addEventListener("click", () => {
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    $("playerShell").requestFullscreen?.();
  });

  // Cinema mode
  els.cinemaBtn?.addEventListener("click", () => {
    els.appShell.classList.toggle("cinema-mode");
  });

  // Mode toggle removed

  // Panel Dragging
  let isDraggingPanel = false, startX, startY, initialLeft, initialTop;
  els.panelDragHandle?.addEventListener("mousedown", e => {
    if (e.target.tagName === "BUTTON") return;
    isDraggingPanel = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = els.adminOverlay.getBoundingClientRect();
    initialLeft = rect.left;
    initialTop = rect.top;
    els.adminOverlay.style.left = initialLeft + "px";
    els.adminOverlay.style.top = initialTop + "px";
    els.adminOverlay.style.bottom = "auto";
    els.adminOverlay.style.right = "auto";
  });
  window.addEventListener("mousemove", e => {
    if (!isDraggingPanel) return;
    els.adminOverlay.style.left = (initialLeft + e.clientX - startX) + "px";
    els.adminOverlay.style.top = (initialTop + e.clientY - startY) + "px";
  });
  window.addEventListener("mouseup", () => { isDraggingPanel = false; });

  // Minimize
  els.minimizeBtn?.addEventListener("click", () => {
    els.sourcePanel.classList.toggle("minimized");
    if (els.minimizeBtn) {
      els.minimizeBtn.textContent = els.sourcePanel.classList.contains("minimized") ? "□" : "_";
    }
  });
}

/* ─── Admin Panel ─── */
function showAdminPanel() {
  els.adminOverlay.removeAttribute("hidden");
  const obsServerUrl = "rtmp://127.0.0.1/live";
  const whipField = $("whipUrlField");
  const keyField = $("streamKeyField");
  if (whipField) whipField.value = obsServerUrl;
  if (keyField) keyField.value = S.streamKey;

  $("copyWhipUrl")?.addEventListener("click", () => {
    navigator.clipboard.writeText(obsServerUrl).then(() => {
      $("copyWhipUrl").textContent = "✅";
      setTimeout(() => $("copyWhipUrl").textContent = "📋", 1500);
    });
  });
  $("copyStreamKey")?.addEventListener("click", () => {
    navigator.clipboard.writeText(S.streamKey).then(() => {
      $("copyStreamKey").textContent = "✅";
      setTimeout(() => $("copyStreamKey").textContent = "📋", 1500);
    });
  });
  $("toggleKeyVisibility")?.addEventListener("click", () => {
    if (keyField.type === "password") {
      keyField.type = "text";
      $("toggleKeyVisibility").textContent = "🙈";
    } else {
      keyField.type = "password";
      $("toggleKeyVisibility").textContent = "👁️";
    }
  });
}

/* ─── Playback Controller ─── */
function startPlayback() {
  const attempt = ++S.playbackAttempt;
  stopCurrentPlayback();
  connectWHEP(attempt).catch((err) => {
    fallbackToHLS(attempt, err);
  });
}

function stopPlayback() {
  S.playbackAttempt++;
  stopCurrentPlayback();
  if (S.retryTimer) { clearTimeout(S.retryTimer); S.retryTimer = null; }
}

function stopCurrentPlayback() {
  if (S.hls) { S.hls.destroy(); S.hls = null; }
  stopWebRTC();
  els.viewerVideo.srcObject = null;
  els.viewerVideo.src = "";
  els.viewerVideo.removeAttribute("src");
  els.viewerVideo.load?.();
}

function stopWebRTC() {
  if (S.whepSessionUrl) {
    fetch(S.whepSessionUrl, { method: "DELETE", keepalive: true }).catch(() => {});
    S.whepSessionUrl = null;
  }
  if (S.pc) {
    S.pc.ontrack = null;
    S.pc.onconnectionstatechange = null;
    S.pc.oniceconnectionstatechange = null;
    S.pc.close();
    S.pc = null;
  }
}

function setPlaybackMode(mode) {
  S.mode = mode;
  if (els.modePill) els.modePill.textContent = mode === "webrtc" ? "WebRTC" : "LL-HLS";
}

async function connectWHEP(attempt) {
  if (!("RTCPeerConnection" in window)) {
    throw new Error("WebRTC is not supported by this browser");
  }

  setPlaybackMode("webrtc");
  setStatus("WebRTC baglaniyor...");

  const pc = new RTCPeerConnection(ICE);
  S.pc = pc;

  const remoteStream = new MediaStream();
  let trackSettled = false;
  const firstTrack = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!trackSettled) reject(new Error("WHEP media timed out"));
    }, 8000);

    pc.ontrack = (event) => {
      if (attempt !== S.playbackAttempt) return;
      trackSettled = true;
      clearTimeout(timer);

      const stream = event.streams[0] || remoteStream;
      if (!event.streams[0] && !remoteStream.getTracks().includes(event.track)) {
        remoteStream.addTrack(event.track);
      }
      if (els.viewerVideo.srcObject !== stream) els.viewerVideo.srcObject = stream;
      els.viewerVideo.play().catch(() => {});
      markLive();
      setPlaybackMode("webrtc");
      setStatus("Yayin aktif (WebRTC)");
      resolve();
    };
  });
  firstTrack.catch(() => {});

  const failStates = new Set(["failed", "closed"]);
  pc.onconnectionstatechange = () => {
    if (attempt !== S.playbackAttempt || S.mode !== "webrtc") return;
    if (failStates.has(pc.connectionState)) {
      fallbackToHLS(attempt, new Error(`WebRTC ${pc.connectionState}`));
    }
  };
  pc.oniceconnectionstatechange = () => {
    if (attempt !== S.playbackAttempt || S.mode !== "webrtc") return;
    if (pc.iceConnectionState === "failed") {
      fallbackToHLS(attempt, new Error("WebRTC ICE failed"));
    }
  };

  pc.addTransceiver("video", { direction: "recvonly" });
  pc.addTransceiver("audio", { direction: "recvonly" });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForIceGatheringComplete(pc, 3500);

  if (attempt !== S.playbackAttempt) return;

  const response = await fetch("/live/whep", {
    method: "POST",
    headers: {
      "content-type": "application/sdp",
      "accept": "application/sdp",
    },
    body: pc.localDescription.sdp,
  });

  if (!response.ok) {
    throw new Error(`WHEP returned HTTP ${response.status}`);
  }

  S.whepSessionUrl = response.headers.get("location") || null;
  const answer = await response.text();
  await pc.setRemoteDescription({ type: "answer", sdp: answer });
  await firstTrack;
}

function waitForIceGatheringComplete(pc, timeoutMs) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();

  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", onStateChange);
      resolve();
    };
    const onStateChange = () => {
      if (pc.iceGatheringState === "complete") done();
    };
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener("icegatheringstatechange", onStateChange);
  });
}

function fallbackToHLS(attempt, err) {
  if (attempt !== S.playbackAttempt || !S.isLive || S.mode === "hls") return;
  console.warn("WebRTC fallback to HLS:", err?.message || err);
  stopWebRTC();
  connectHLS(attempt);
}

/* ─── HLS Viewer ─── */
function connectHLS(attempt = S.playbackAttempt) {
  if (S.hls) { S.hls.destroy(); S.hls = null; }
  setPlaybackMode("hls");
  setStatus("LL-HLS yukleniyor...");

  const hlsBase = S.hlsOrigin ? S.hlsOrigin : "";
  const hlsUrl = `${hlsBase}/live/index.m3u8`;

  if (typeof Hls !== "undefined" && Hls.isSupported()) {
    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 6,
      maxBufferLength: 6,
      maxMaxBufferLength: 12,
      liveSyncDuration: 1.5,
      liveMaxLatencyDuration: 4,
      maxLiveSyncPlaybackRate: 1.15,
      liveDurationInfinity: true,
      manifestLoadingTimeOut: 8000,
      manifestLoadingMaxRetry: 3,
      levelLoadingTimeOut: 8000,
      levelLoadingMaxRetry: 3,
      fragLoadingTimeOut: 8000,
      fragLoadingMaxRetry: 3,
      xhrSetup: (xhr) => {
        xhr.timeout = 8000;
      },
    });
    S.hls = hls;
    S._errorCount = 0;

    hls.loadSource(hlsUrl);
    hls.attachMedia(els.viewerVideo);

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      if (attempt !== S.playbackAttempt) return;
      els.viewerVideo.play().catch(() => {});
      markLive();
      S._errorCount = 0;
      setPlaybackMode("hls");
      setStatus("Yayin aktif (LL-HLS)");
    });

    hls.on(Hls.Events.LEVEL_LOADED, (_, data) => {
      if (attempt !== S.playbackAttempt) return;
      S._errorCount = 0; // Reset error count on successful load
      const lvl = hls.levels?.[hls.currentLevel];
      if (lvl && els.qualityPill) {
        els.qualityPill.textContent = `${lvl.width}x${lvl.height}`;
      }
    });

    hls.on(Hls.Events.FRAG_LOADED, () => {
      if (attempt !== S.playbackAttempt) return;
      S._errorCount = 0; // Reset on every successful fragment
    });

    hls.on(Hls.Events.ERROR, (_, data) => {
      if (attempt !== S.playbackAttempt) return;
      if (!data.fatal) {
        // Non-fatal: just count, don't restart
        S._errorCount = (S._errorCount || 0) + 1;
        if (S._errorCount > 20) {
          // Too many non-fatal errors in a row - try recovery
          console.warn("HLS: too many non-fatal errors, recovering...");
          S._errorCount = 0;
          hls.recoverMediaError();
        }
        return;
      }

      console.warn("HLS fatal error:", data.type, data.details);

      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        // Try media recovery first (no reconnect)
        console.warn("HLS: attempting media recovery...");
        hls.recoverMediaError();
      } else if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        // Network error: try startLoad first, reconnect only if that fails too
        setStatus("Yeniden baglaniyor...");
        try {
          hls.startLoad();
        } catch {
          hls.destroy(); S.hls = null;
          scheduleReconnect();
        }
      } else {
        hls.destroy(); S.hls = null;
        scheduleReconnect();
      }
    });

  } else if (els.viewerVideo.canPlayType("application/vnd.apple.mpegurl")) {
    // Safari native HLS
    els.viewerVideo.src = hlsUrl;
    els.viewerVideo.onloadedmetadata = () => {
      if (attempt !== S.playbackAttempt) return;
      els.viewerVideo.play().catch(() => {});
      markLive();
      setPlaybackMode("hls");
      setStatus("Yayin aktif (Safari HLS)");
    };
  } else {
    setStatus("HLS desteklenmiyor.");
  }
}

/* ─── Reconnect Logic ─── */
function scheduleReconnect() {
  if (S.retryTimer) return;
  const delay = 3000;
  setStatus(`${delay / 1000}s icinde yeniden deneniyor...`);
  S.retryTimer = setTimeout(() => {
    S.retryTimer = null;
    if (S.isLive) startPlayback();
  }, delay);
}

async function updateQualityInfo() {
  // HLS updates quality inside the LEVEL_LOADED event
}

/* ─── Stream Status Polling ─── */
let _offlineCount = 0; // Debounce: require multiple consecutive offline checks
async function pollStreamStatus() {
  try {
    const r = await fetch("/api/config", { cache: "no-store" });
    const d = await r.json();
    const isOnline = d.broadcasterOnline;

    // Optional external HLS origin; default is this same Render app.
    if (d.hlsOrigin && d.hlsOrigin !== S.hlsOrigin) {
      S.hlsOrigin = d.hlsOrigin;
      console.log("[HLS] Origin set to:", S.hlsOrigin);
    }

    if (isOnline) {
      _offlineCount = 0; // Reset offline counter
      if (!S.isLive) {
        S.isLive = true;
        startPlayback();
      }
    } else {
      _offlineCount++;
      // Only mark offline after 4 consecutive offline checks (= ~16 seconds)
      // This prevents brief MediaMTX API blips from killing the stream
      if (_offlineCount >= 4 && S.isLive) {
        S.isLive = false;
        markOffline();
      } else if (!S.isLive) {
        setStatus("Yayın bekleniyor...");
      }
    }

    // Update admin panel
    const adminStatus = $("adminStreamStatus");
    const adminViewers = $("adminViewerCount");
    if (adminStatus) {
      adminStatus.textContent = S.isLive ? "● Canlı" : "● Çevrimiçi Değil";
      adminStatus.className = "admin-value " + (S.isLive ? "status-live" : "status-offline");
    }
    if (adminViewers) adminViewers.textContent = d.readers || d.viewerCount || 0;
  } catch {}
  setTimeout(pollStreamStatus, 4000);
}

/* ─── WebSocket for live updates ─── */
function connectWebSocket() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  S.ws = ws;

  ws.onmessage = e => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === "stream-status") {
        // Only use WS to START playback (going live)
        // Do NOT use it to stop - pollStreamStatus handles offline with debounce
        if (msg.online && !S.isLive) {
          _offlineCount = 0;
          S.isLive = true;
          startPlayback();
        }
        if (els.viewerCount) els.viewerCount.textContent = msg.readers || 0;
      }
    } catch {}
  };

  ws.onclose = () => setTimeout(connectWebSocket, 5000);
  ws.onerror = () => {};
}

/* ─── UI helpers ─── */
function markLive() {
  els.emptyState.classList.add("is-hidden");
  els.livePill.classList.add("is-live");
  if (!S.liveAt) S.liveAt = Date.now();
  S.isLive = true;
}

function markOffline() {
  stopPlayback();
  els.emptyState.classList.remove("is-hidden");
  els.livePill.classList.remove("is-live");
  setPlaybackMode("webrtc");
  if (els.qualityPill) els.qualityPill.textContent = "Baglaniyor...";
  S.liveAt = null;
  S.isLive = false;
  setStatus("Yayin bekleniyor");
}

function setStatus(t) { if (els.status) els.status.textContent = t; }

function startTimer() {
  setInterval(() => {
    if (!S.liveAt) { if (els.liveTimer) els.liveTimer.textContent = "00:00"; return; }
    const sec = Math.floor((Date.now() - S.liveAt) / 1000);
    const h = Math.floor(sec / 3600);
    const m = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
    const s = String(sec % 60).padStart(2, "0");
    if (els.liveTimer) els.liveTimer.textContent = h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
  }, 1000);
}

function cleanNick(v) {
  return String(v || "").replace(/[^\p{L}\p{N}_\-. ]/gu, "").replace(/\s+/g, " ").trim().slice(0, 24);
}

/* ─── Chat (SSE) ─── */
function connectChat() {
  const src = new EventSource("/api/chat/stream");
  src.addEventListener("presence", e => {
    const d = JSON.parse(e.data);
    if (els.viewerCount) els.viewerCount.textContent = d.viewers || 0;
  });
  src.onerror = () => {};
}
