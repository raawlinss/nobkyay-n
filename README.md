# NOBKFİLM Live — OBS Streaming Platform

OBS'den doğrudan WHIP ile yayın yapıp, tarayıcıdan izlenen profesyonel canlı yayın platformu.

## Mimari

```
OBS Studio ──WHIP──→ Render.com Docker
                      ├── MediaMTX (video+ses alır, dağıtır)
                      ├── Node.js  (frontend, chat, proxy)
                      └── Viewer ←──WHEP── tarayıcı
```

## Render.com'a Deploy

### 1. GitHub'a Push Et
```bash
git add .
git commit -m "OBS WHIP streaming"
git push
```

### 2. Render.com'da Yeni Web Service Oluştur
1. https://dashboard.render.com → **New → Web Service**
2. GitHub repo'nu bağla
3. Ayarlar:
   - **Environment**: Docker
   - **Plan**: Free (veya Starter)
   - **Region**: Frankfurt (EU) veya en yakın
4. **Environment Variables** ekle:
   - `STREAM_KEY` = senin istediğin şifre (örn: `NOBK-RAW-2024`)
   - `PORT` = `7860`
5. **Deploy** et

### 3. OBS Ayarları
1. OBS'yi aç → **Ayarlar → Yayın**
2. **Hizmet**: `WHIP`
3. **Sunucu**: `https://SENIN-APP.onrender.com/live/whip`
4. **Bearer Token (Anahtar)**: `?key=STREAM_KEY_DEĞERIN`
   - Örnek: `?key=NOBK-RAW-2024`
5. **Yayını Başlat** butonuna bas

### 4. Admin Panel
- Tarayıcıda `https://SENIN-APP.onrender.com/#admin` aç
- Stream Key'i gir
- OBS bağlantı bilgilerini göreceksin

### 5. İzleyiciler
- `https://SENIN-APP.onrender.com` adresine girip izlerler
- Ses ve video otomatik gelir (WHEP ile)

## Yerel Geliştirme

```bash
npm install
npm run dev
```

> Not: Yerel geliştirme için MediaMTX binary'si gerekir.
> https://github.com/bluenviron/mediamtx/releases adresinden indir.

## Teknoloji Stack
- **MediaMTX**: WHIP ingest + WHEP playback + HLS fallback
- **Node.js**: Frontend, chat (SSE), MediaMTX proxy
- **WebRTC**: Ultra-düşük gecikme
- **Twitch Chat**: Embed iframe
