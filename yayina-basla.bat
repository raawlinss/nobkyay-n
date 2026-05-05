@echo off
chcp 65001 >nul
title NOBKFİLM Canlı Yayın Başlatıcı

echo.
echo ╔══════════════════════════════════════════╗
echo ║    NOBKFİLM CANLI YAYIN BAŞLATICI       ║
echo ╚══════════════════════════════════════════╝
echo.

:: Eski işlemleri temizle
echo [1/4] Eski işlemler temizleniyor...
taskkill /f /im mediamtx.exe >nul 2>&1
taskkill /f /im cloudflared.exe >nul 2>&1

:: Port kontrolü
netstat -ano | findstr :1935 | findstr LISTENING >nul 2>&1
if %errorlevel%==0 (
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr :1935 ^| findstr LISTENING') do (
        taskkill /f /pid %%a >nul 2>&1
    )
)

timeout /t 1 /nobreak >nul

:: MediaMTX başlat
echo [2/4] MediaMTX başlatılıyor...
if not exist "mediamtx.exe" (
    echo HATA: mediamtx.exe bulunamadı! Bu bat dosyasıyla aynı klasörde olmalı.
    pause
    exit /b 1
)
start /min "MediaMTX" mediamtx.exe mediamtx.yml
timeout /t 3 /nobreak >nul
echo    MediaMTX hazır ✓

:: Node.js sunucusu başlat
echo [3/4] Node.js sunucusu başlatılıyor...
start /min "NOBKFİLM Server" node server.js
timeout /t 2 /nobreak >nul
echo    Node.js hazır ✓

:: Cloudflare Tunnel başlat ve URL'i yakala
echo [4/4] Cloudflare tüneli açılıyor (30 saniye sürebilir)...
set TUNNEL_LOG=%TEMP%\nobk_tunnel.log
start /min "Cloudflare Tunnel" cmd /c "cloudflared tunnel --url http://localhost:7860 --no-autoupdate 2>&1 | tee %TUNNEL_LOG%"

:: URL gelene kadar bekle
set TUNNEL_URL=
set /a WAIT=0
:waitloop
timeout /t 2 /nobreak >nul
set /a WAIT+=2
findstr /i "trycloudflare.com" %TUNNEL_LOG% >nul 2>&1
if %errorlevel%==0 (
    for /f "tokens=*" %%a in ('findstr /i "trycloudflare.com" %TUNNEL_LOG%') do (
        for %%b in (%%a) do (
            echo %%b | findstr /i "https://" >nul 2>&1
            if !errorlevel!==0 set TUNNEL_URL=%%b
        )
    )
    goto :found
)
if %WAIT% geq 60 goto :timeout
goto :waitloop

:timeout
echo.
echo ⚠ Tünel URL'i alınamadı, tunnel.log dosyasını kontrol edin: %TUNNEL_LOG%
goto :show_info

:found
echo    Cloudflare tüneli hazır ✓
echo.
echo ╔══════════════════════════════════════════════════════════╗
echo ║                 YAYIN BİLGİLERİ                         ║
echo ╠══════════════════════════════════════════════════════════╣
echo ║  İZLEYİCİ LİNKİ: %TUNNEL_URL%
echo ║                                                          ║
echo ║  OBS AYARLARI:                                           ║
echo ║  • Hizmet    : Özel (Custom)                             ║
echo ║  • Sunucu    : rtmp://127.0.0.1/live                     ║
echo ║  • Yayın Anh.: (BOŞALT - hiçbir şey yazma)              ║
echo ╚══════════════════════════════════════════════════════════╝

:show_info
echo.
echo Bu pencereyi KAPATMA - Kapatırsan yayın durur!
echo.
echo Yayını durdurmak için bu pencereyi kapatın veya CTRL+C basın.
echo.
pause >nul
