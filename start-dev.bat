@echo off
setlocal

cd /d "%~dp0"
title KUMOHIRO Daka - Local Server

where node.exe >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found.
  echo Install Node.js 22 or later, then run this file again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing dependencies...
  call npm.cmd install
  if errorlevel 1 (
    echo.
    echo [ERROR] Dependency installation failed.
    pause
    exit /b 1
  )
)

powershell.exe -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 3101 -State Listen -ErrorAction SilentlyContinue) { exit 1 }"
if errorlevel 1 (
  echo.
  echo [ERROR] Port 3101 is already in use.
  echo Close the previous KUMOHIRO Daka window, then run this file again.
  echo.
  pause
  exit /b 1
)

echo.
echo Preparing KUMOHIRO Daka...
call npm.cmd run build
if errorlevel 1 (
  echo.
  echo [ERROR] Frontend build failed.
  pause
  exit /b 1
)

cls
echo ========================================================
echo   KUMOHIRO Daka is starting...
echo ========================================================
echo.
echo Frontend: http://127.0.0.1:3101/
echo Admin:    http://127.0.0.1:3101/admin
echo.
echo Keep this window open. Closing it will stop the service.
echo There is no automatic restart or page refresh in this mode.
echo ========================================================
echo.

set "SERVE_CLIENT=1"
set "PORT=3101"

start "" /b powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:3101/'"

node.exe server\src\index.js

echo.
echo The service has stopped.
pause
