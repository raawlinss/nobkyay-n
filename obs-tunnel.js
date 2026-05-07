"use strict";

const fs = require("fs");
const http = require("http");
const https = require("https");
const net = require("net");
const WebSocket = require("ws");

const DEFAULT_RENDER_URL = "https://nobkyayin.onrender.com";
const DEFAULT_STREAM_KEY = "NOBK-RAW";
const LOCAL_PORT = Number.parseInt(process.env.LOCAL_RTMP_PORT || "1935", 10);
const PREOPEN_BUFFER_LIMIT = 4 * 1024 * 1024;
const LIVE_BUFFER_LIMIT = 8 * 1024 * 1024;

loadLocalEnv();

const renderBase = normalizeBase(process.argv[2] || process.env.RENDER_URL || DEFAULT_RENDER_URL);
const httpBase = toHttpBase(renderBase);
const wsTarget = `${toWsBase(renderBase)}/rtmp-tunnel?key=${encodeURIComponent(
  (process.argv[3] || process.env.STREAM_KEY || DEFAULT_STREAM_KEY).trim()
)}`;

function loadLocalEnv() {
  if (!fs.existsSync(".env.local")) return;
  const lines = fs.readFileSync(".env.local", "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function normalizeBase(value) {
  let base = String(value || DEFAULT_RENDER_URL).trim();
  if (!/^https?:\/\//i.test(base) && !/^wss?:\/\//i.test(base)) {
    base = `https://${base}`;
  }
  return base.replace(/\/+$/, "");
}

function toHttpBase(base) {
  return base.replace(/^wss:\/\//i, "https://").replace(/^ws:\/\//i, "http://");
}

function toWsBase(base) {
  return base.replace(/^https:\/\//i, "wss://").replace(/^http:\/\//i, "ws://");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestHealth(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https://") ? https : http;
    const req = client.get(url, (res) => {
      res.resume();
      if (res.statusCode && res.statusCode < 500) resolve();
      else reject(new Error(`HTTP ${res.statusCode || 0}`));
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", reject);
  });
}

async function warmRender() {
  const healthUrl = `${httpBase}/api/health`;
  console.log(`Render kontrol ediliyor: ${healthUrl}`);
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      await requestHealth(healthUrl);
      console.log("Render hazir.");
      return;
    } catch (err) {
      console.log(`Render henuz hazir degil (${attempt}/6): ${err.message}`);
      await sleep(5000);
    }
  }
  console.log("Render saglik kontrolu alinamadi; tunel yine de aciliyor.");
}

function startTunnelServer() {
  const server = net.createServer((socket) => {
    socket.setNoDelay(true);
    console.log("OBS yerel RTMP tuneline baglandi. Render'a WSS tuneli aciliyor...");

    const pending = [];
    let pendingBytes = 0;
    let upstreamBytes = 0;
    let downstreamBytes = 0;
    let closed = false;
    let wsOpen = false;
    let closeReason = "";

    const ws = new WebSocket(wsTarget, {
      handshakeTimeout: 15000,
      perMessageDeflate: false,
    });

    const closeBoth = (reason) => {
      if (closed) return;
      closed = true;
      closeReason = reason || closeReason || "Tunel kapandi.";
      console.log(`${closeReason} (OBS->Render ${upstreamBytes} bytes, Render->OBS ${downstreamBytes} bytes)`);
      if (!socket.destroyed) socket.destroy();
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
    };

    const sendToRender = (data) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (ws.bufferedAmount > LIVE_BUFFER_LIMIT) {
        closeBoth("Render tunel tamponu doldu. OBS bitrate dusurulmeli veya baglanti kontrol edilmeli.");
        return;
      }
      upstreamBytes += data.length;
      ws.send(data, { binary: true });
    };

    ws.on("open", () => {
      wsOpen = true;
      console.log("Render tuneli acildi. OBS yayini sabit siteye aktariliyor.");
      for (const chunk of pending.splice(0)) sendToRender(chunk);
      pendingBytes = 0;
    });

    ws.on("message", (data) => {
      downstreamBytes += data.length;
      if (!socket.destroyed) socket.write(data);
    });

    socket.on("data", (data) => {
      if (wsOpen && ws.readyState === WebSocket.OPEN) {
        sendToRender(data);
        return;
      }

      pendingBytes += data.length;
      if (pendingBytes > PREOPEN_BUFFER_LIMIT) {
        closeBoth("Render tuneli acilmadan OBS cok veri gonderdi. Biraz bekleyip tekrar baslatin.");
        return;
      }
      pending.push(data);
    });

    ws.on("close", (code, reason) => {
      const reasonText = reason?.toString?.() || "";
      closeBoth(`Render tuneli kapandi. code=${code}${reasonText ? ` reason=${reasonText}` : ""}`);
    });
    ws.on("error", (err) => closeBoth(`Render tunel hatasi: ${err.message}`));
    socket.on("close", (hadError) => closeBoth(`OBS baglantisi kapandi${hadError ? " (hata ile)" : ""}.`));
    socket.on("error", (err) => closeBoth(`OBS soket hatasi: ${err.message}`));
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Port ${LOCAL_PORT} kullanimda. Eski yayin/tunel pencerelerini kapatip tekrar deneyin.`);
      process.exitCode = 1;
      return;
    }
    console.error("Yerel RTMP tunel hatasi:", err.message);
    process.exitCode = 1;
  });

  server.listen(LOCAL_PORT, "127.0.0.1", () => {
    console.log("");
    console.log("======================================================");
    console.log(" NOBKFILM RENDER OBS TUNELI HAZIR");
    console.log("======================================================");
    console.log(`Sabit izleyici linki : ${httpBase}/`);
    console.log(`Tunel hedefi         : ${wsTarget.split("?")[0]}`);
    console.log("");
    console.log("OBS ayarlari ayni kaliyor:");
    console.log("  Hizmet  : Ozel (Custom)");
    console.log("  Sunucu  : rtmp://127.0.0.1/live");
    console.log("  Anahtar : bos birak");
    console.log("");
    console.log("Bu pencere acik kaldigi surece OBS yayini Render sitesine aktarilir.");
    console.log("");
  });
}

warmRender().then(startTunnelServer).catch((err) => {
  console.error("Tunel baslatilamadi:", err.message);
  process.exitCode = 1;
});
