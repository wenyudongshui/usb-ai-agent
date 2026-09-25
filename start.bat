@echo off
setlocal EnableExtensions
chcp 65001 >nul
title USB AI Agent launcher

rem ============================================================
rem  start.bat — USB AI Agent entry
rem  Delegates to tools\bootstrap.ps1 which:
rem   - locates / downloads a pinned portable Node.js into engine\
rem     (SHA256 verified) on first run
rem   - runs: node tools\launcher.mjs [subcommand]
rem ============================================================

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\bootstrap.ps1" %*
set "EXITCODE=%ERRORLEVEL%"
if not "%EXITCODE%"=="0" (
    echo.
    echo [ERROR] USB AI Agent failed to start ^(exit code %EXITCODE%^).
    echo         If this was the first run and it was downloading the runtime,
    echo         check your network connection and try again.
    pause
)
exit /b %EXITCODE%