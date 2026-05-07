# NOBKFILM Live

OBS ayari bozulmadan sabit Render adresinden yayin:

https://nobkyayin.onrender.com/

## Yeni mimari

```
OBS
  -> rtmp://127.0.0.1/live
  -> obs-tunnel.js (yerel RTMP -> WSS)
  -> https://nobkyayin.onrender.com/rtmp-tunnel
  -> Render icindeki MediaMTX
  -> Izleyici: WebRTC/WHEP, olmazsa Low-Latency HLS
```

Cloudflare/trycloudflare linki artik yayin icin gerekli degil. `yayina-basla.bat`
yalnizca yerel OBS RTMP cikisini Render'daki sabit siteye tasir.

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
2. Pencere Render'in hazir oldugunu soyleyene kadar bekle.
3. OBS ayarlari:
   - Hizmet: `Ozel (Custom)`
   - Sunucu: `rtmp://127.0.0.1/live`
   - Anahtar: bos birak
4. OBS'te `Yayini Baslat`.
5. Izleyiciler hep `https://nobkyayin.onrender.com/` adresinden girer.

## Gecikme notlari

- Tarayici once WebRTC/WHEP dener; Render/WebRTC agi izin vermezse otomatik
  olarak Low-Latency HLS'e duser.
- OBS tarafinda keyframe interval degerini `1s` yapmak HLS gecikmesini azaltir.
- Bitrate baglantinin kaldiramayacagi kadar yuksek olursa tunel tamponu buyur ve
  gecikme artar. Bu durumda OBS bitrate'i dusurun.

## Yerel gelistirme

```bash
npm install
npm run dev
```

Yerel gelistirme icin MediaMTX binary'si gerekir.
