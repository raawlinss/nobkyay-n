@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

set "RENDER_URL=https://nobkyayin.onrender.com"
set "STREAM_KEY="

if exist ".env.local" (
    for /f "usebackq tokens=1,* delims==" %%A in (".env.local") do (
        if /i "%%~A"=="STREAM_KEY" set "STREAM_KEY=%%~B"
    )
)

if not defined STREAM_KEY set "STREAM_KEY=NOBK-RAW"

echo.
echo ===================================================
echo    NOBKFILM CANLI YAYIN BASLATICI
echo ===================================================
echo.
echo Sabit izleyici linki:
echo   %RENDER_URL%/
echo.

echo [1/3] Node.js kontrol ediliyor...
where node >nul 2>&1
if errorlevel 1 (
    echo HATA: Node.js bulunamadi. Node.js kurulu olmali.
    pause
    exit /b 1
)

echo [2/3] OBS profili WHIP icin hazirlaniyor...
node configure-obs-whip.js "%RENDER_URL%" "%STREAM_KEY%"
if errorlevel 1 (
    echo HATA: OBS profili guncellenemedi.
    pause
    exit /b 1
)

echo [3/3] OBS durumu kontrol ediliyor...
tasklist /fi "imagename eq obs64.exe" | find /i "obs64.exe" >nul
if not errorlevel 1 (
    echo.
    echo OBS su anda acik gorunuyor.
    echo Degisikliklerin tam uygulanmasi icin OBS'yi kapatip yeniden ac.
)

echo.
echo OBS ayarlari:
echo   Hizmet       : WHIP
echo   Sunucu       : %RENDER_URL%/live/whip
echo   Bearer Token : %STREAM_KEY%
echo.
echo Artik yerel RTMP tuneli gerekmiyor.
echo OBS'te Yayini Baslat dediginde yayin dogrudan sabit siteye gidecek:
echo   %RENDER_URL%/
echo.
pause
