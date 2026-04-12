@echo off
title AstraXML – Dev Launcher
echo Starting AstraXML...

where npm >nul 2>&1
if errorlevel 1 (
    echo ERROR: npm not found. Please install Node.js from https://nodejs.org
    pause
    exit /b 1
)

cd /d "%~dp0..\astraxml"
echo Installing dependencies...
call npm install
echo Launching app...
call npm run tauri dev
pause
