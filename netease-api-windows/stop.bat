@echo off
chcp 65001 >nul
cd /d "%~dp0"

set PORT=3000
if exist ".env" (
  for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
    if "%%a"=="PORT" set PORT=%%b
  )
)

echo Stopping API service on port %PORT% ...
set FOUND=0
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
  echo   killing PID %%p
  taskkill /PID %%p /F >nul 2>&1
  set FOUND=1
)

if "%FOUND%"=="0" (
  echo No API service listening on port %PORT%.
) else (
  echo Stopped.
)

echo Stopping music player on port 8080 ...
set FOUND2=0
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8080 " ^| findstr "LISTENING"') do (
  echo   killing PID %%p
  taskkill /PID %%p /F >nul 2>&1
  set FOUND2=1
)

if "%FOUND2%"=="0" (
  echo No music player listening on port 8080.
) else (
  echo Stopped.
)

pause
