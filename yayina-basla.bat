@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

set "RENDER_URL=https://nobkyayin.onrender.com"

echo.
echo ===================================================
echo    NOBKFILM CANLI YAYIN BASLATICI
echo ===================================================
echo.
echo Sabit izleyici linki:
echo   %RENDER_URL%/
echo.

echo [1/3] Eski yerel yayin parcalari temizleniyor...
taskkill /f /im cloudflared.exe >nul 2>&1
taskkill /f /im mediamtx.exe >nul 2>&1

for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":1935 " ^| findstr LISTENING') do (
    taskkill /f /pid %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul

echo [2/3] Node.js ve bagimliliklar kontrol ediliyor...
where node >nul 2>&1
if errorlevel 1 (
    echo HATA: Node.js bulunamadi. Node.js kurulu olmali.
    pause
    exit /b 1
)

if not exist "node_modules\ws\package.json" (
    echo ws paketi eksik, npm install calistiriliyor...
    npm install
    if errorlevel 1 (
        echo HATA: npm install basarisiz oldu.
        pause
        exit /b 1
    )
)

echo [3/3] Render OBS tuneli baslatiliyor...
echo.
echo OBS ayarlari degismiyor:
echo   Hizmet  : Ozel (Custom)
echo   Sunucu  : rtmp://127.0.0.1/live
echo   Anahtar : bos birak
echo.
echo Bu pencereyi kapatma. OBS'te Yayini Baslat dediginde yayin
echo dogrudan %RENDER_URL%/ sitesine aktarilacak.
echo.

node obs-tunnel.js "%RENDER_URL%"

echo.
echo Tunel kapandi.
pause
