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

echo Starting Netease Cloud Music API service (port from .env, default 3000)
echo Close this window to stop the service
echo.
node src\index.js
