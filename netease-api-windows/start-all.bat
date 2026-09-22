@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo Created .env from .env.example
)

if not exist "node_modules" (
  echo First run, installing dependencies...
  call npm install --registry=https://registry.npmmirror.com --no-audit --no-fund
)

echo [1/3] Starting API service  (3000)
start "netease-api :3000" /min cmd /c "node src\index.js"

echo [2/3] Waiting for API to become ready...
node scripts\wait-ready.js http://127.0.0.1:3000/health 30
if errorlevel 1 (
  echo Warning: API did not respond in 30s. Check the minimized window for errors.
) else (
  echo       API is up.
)

echo [3/3] Starting music player  (8080)
start "music-player :8080" /min cmd /c "node scripts\serve-player.js"

node scripts\wait-ready.js http://127.0.0.1:8080/ 15 >nul
start "" "http://localhost:8080"

echo.
echo -------------------------------------------
echo   API      http://127.0.0.1:3000
echo   Player   http://localhost:8080
echo -------------------------------------------
echo Both services run in minimized windows.
echo To stop everything:  stop.bat
echo This window will close in 8 seconds.
timeout /t 8 /nobreak >nul
