@echo off
setlocal
title AstraXML - Dev Launcher
echo Starting AstraXML structured launcher...

where node >nul 2>&1
if errorlevel 1 (
    echo ERROR: node not found. Please install Node.js from https://nodejs.org
    pause
    exit /b 1
)

call node "%~dp0dev-launcher.mjs" %*
pause
