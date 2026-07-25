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

echo.
echo Starting KUMOHIRO Daka...
echo Frontend: http://127.0.0.1:5173/
echo Admin:    http://127.0.0.1:5173/admin
echo.
echo Keep this window open while using the application.
echo Closing this window will stop both the frontend and API services.
echo.

call npm.cmd run dev

echo.
echo The services have stopped.
pause
