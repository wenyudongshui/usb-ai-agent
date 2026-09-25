@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title USB AI Agent launcher

rem ---- Locate the USB drive letter this script lives on ----
set "DRIVE=%~d0"

if not exist "%DRIVE%\node\node.exe" (
    echo [ERROR] Node runtime not found: %DRIVE%\node\node.exe
    echo         Please extract a portable Node.js (Windows x64 LTS) into the node\ folder.
    pause
    exit /b 1
)

rem ---- Find a free port starting from 8787 ----
set "PORT=8787"
for /L %%p in (8787,1,8807) do (
    netstat -an | findstr /r /c:":%%p " | findstr /c:"LISTENING" >nul 2>&1
    if errorlevel 1 (
        set "PORT=%%p"
        goto :portok
    )
)
set "PORT=8787"
:portok
echo [INFO] Using port !PORT!

rem ---- Start the local web server with the chosen port ----
start "USB-AI-Server" /min "%DRIVE%\node\node.exe" "%DRIVE%\app\server.js" !PORT!

rem ---- Wait a moment, then open the browser to the login page ----
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:!PORT!"

endlocal
