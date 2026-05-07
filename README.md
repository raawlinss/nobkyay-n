# NOBKFILM Live

Sabit Render adresinden, OBS ile dogrudan yayin:

https://nobkyayin.onrender.com/

## Yeni mimari

```text
OBS
  -> WHIP + Bearer Token
  -> https://nobkyayin.onrender.com/live/whip
  -> Node proxy
  -> Render icindeki MediaMTX
  -> Izleyici: WebRTC/WHEP, olmazsa Low-Latency HLS
```

Cloudflare/trycloudflare linki artik gerekli degil. Yerel RTMP tuneli de artik
zorunlu degil. `yayina-basla.bat` OBS profilini otomatik olarak WHIP'e cevirir.

## Render ayarlari

Render servisinde Docker olarak deploy edin ve Environment Variables tarafinda sunu
ayni degerle tutun:

```text
STREAM_KEY=NOBK-RAW
PORT=7860
```

`STREAM_KEY` degerini degistirirseniz `.env.local`, Render Environment Variables
ve yerel tunel ayni degeri kullanmali. `STREAM_ORIGIN` kullanmayin. Bu surum
varsayilan olarak MediaMTX'i Render container icinde `127.0.0.1` uzerinden
kullanir.

## Yayini baslatma

1. `yayina-basla.bat` dosyasini calistir.
2. OBS aciksa kapatip yeniden ac.
3. OBS ayarlari:
   - Hizmet: `WHIP`
   - Sunucu: `https://nobkyayin.onrender.com/live/whip`
   - Bearer Token: `STREAM_KEY` ile ayni deger
4. OBS'te `Yayini Baslat`.
5. Izleyiciler hep `https://nobkyayin.onrender.com/` adresinden girer.

## Gecikme notlari

- Tarayici once WebRTC/WHEP dener; Render/WebRTC agi izin vermezse otomatik
  olarak Low-Latency HLS'e duser.
- WHIP tarafinda OBS kendi uyumlu WebRTC encoder ayarlarini uygular.
- RTMP tunel kopmalarini yasiyorsaniz bu surum o yolu tamamen devreden cikarir.

## Yerel gelistirme

```bash
npm install
npm run dev
```

Yerel gelistirme icin MediaMTX binary'si gerekir.
