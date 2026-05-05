const net = require("net");
const WebSocket = require("ws");

// Kullanım: node obs-tunnel.js [RENDER_APP_URL] [YAYIN_SİFRESİ]
// Örnek: node obs-tunnel.js wss://nobkfilm.onrender.com NOBK-RAW

const RENDER_URL = process.argv[2] || "ws://127.0.0.1:7860";
const STREAM_KEY = process.argv[3] || "NOBK-RAW";

const LOCAL_PORT = 1935;

// URL sonuna rtmp-tunnel ekle
let targetUrl = RENDER_URL.replace(/\/$/, "");
if (targetUrl.startsWith("http://")) targetUrl = targetUrl.replace("http://", "ws://");
if (targetUrl.startsWith("https://")) targetUrl = targetUrl.replace("https://", "wss://");
targetUrl = `${targetUrl}/rtmp-tunnel?key=${STREAM_KEY}`;

const server = net.createServer((socket) => {
  console.log("-> OBS yerel tünele bağlandı. Render'a tünel açılıyor...");

  const ws = new WebSocket(targetUrl);

  ws.on("open", () => {
    console.log("-> 🟢 Render.com sunucusuna tünel başarıyla açıldı!");
  });

  ws.on("message", (data) => {
    socket.write(data);
  });

  socket.on("data", (data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });

  ws.on("close", () => {
    console.log("-> 🔴 Render.com sunucusu tüneli kapattı.");
    socket.end();
  });

  socket.on("close", () => {
    console.log("-> OBS yayını durdurdu.");
    ws.close();
  });

  ws.on("error", (err) => {
    console.error("-> ❌ Render tünel hatası:", err.message);
    socket.end();
  });

  socket.on("error", (err) => {
    console.error("-> ❌ OBS soket hatası:", err.message);
    ws.close();
  });
});

server.listen(LOCAL_PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 NOBKFİLM RENDER.COM OBS TÜNELİ BAŞLATILDI`);
  console.log(`======================================================\n`);
  console.log(`Hedef Sunucu: ${targetUrl.split("?")[0]}`);
  console.log(`Yayın Şifresi: ${STREAM_KEY}`);
  console.log(`\nLütfen OBS'i açın ve şu ayarları girin:\n`);
  console.log(`👉 Hizmet (Service)   : Özel (Custom)`);
  console.log(`👉 Sunucu (Server)    : rtmp://127.0.0.1/live`);
  console.log(`👉 Yayın Anahtarı     : (BOMBOŞ BIRAKIN)`);
  console.log(`\nOBS'te 'Yayını Başlat' dediğinizde yayın doğrudan Render'a aktarılacaktır.\n`);
});
