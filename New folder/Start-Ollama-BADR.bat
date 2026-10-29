@echo off
setlocal
title BaDR Ollama CORS Server
echo.
echo BaDR local Ollama launcher
echo This restarts the existing Ollama server with browser access enabled.
echo It does NOT install Ollama, pull models, or delete your models.
echo Keep this window open while using the local chat.
echo.
where ollama >nul 2>&1
if errorlevel 1 (
  echo ERROR: Ollama command was not found in PATH. Open Ollama once or repair its installation.
  pause
  exit /b 1
)
choice /M "Restart Ollama now (current Ollama requests may be interrupted)"
if errorlevel 2 exit /b 0
echo Stopping existing Ollama process so the new settings take effect...
taskkill /F /IM ollama.exe >nul 2>&1
timeout /t 2 /nobreak >nul
set "OLLAMA_ORIGINS=*"
set "OLLAMA_HOST=127.0.0.1:11434"
echo Starting Ollama on 127.0.0.1:11434 with browser CORS enabled.
echo Installed local models stay on disk. No model download is started.
echo.
ollama serve
if errorlevel 1 (
  echo.
  echo Ollama did not start. If port 11434 is already in use, close the Ollama tray app or other server process and run this file again.
  pause
)
endlocal
