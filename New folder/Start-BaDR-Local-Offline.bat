@echo off
setlocal
cd /d "%~dp0"
echo Starting BaDR from this folder on localhost only.
echo This does not expose the website to your Wi-Fi or the public internet.
start "BaDR Local Offline Server" powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-BaDR-Local-Offline.ps1"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8787/"
endlocal
