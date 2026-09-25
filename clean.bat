@echo off
setlocal EnableExtensions
chcp 65001 >nul
title USB AI Agent - cleanup

rem ============================================================
rem  clean.bat — one-click cleanup of host residue
rem
rem  This script deletes only what the app itself recorded in
rem  keys\cache_path.txt (its own cache directories / host
rem  workspace cache). It does NOT touch pagefiles or system
rem  logs. Run it after quitting the app, before unplugging.
rem ============================================================

set "DRIVE=%~d0"

if not exist "%DRIVE%\keys\cache_path.txt" (
    echo [INFO] No cache_path.txt found - nothing to clean.
    exit /b 0
)

echo Cleaning recorded cache paths from %DRIVE%\keys\cache_path.txt ...
echo.

for /f "usebackq delims=" %%P in ("%DRIVE%\keys\cache_path.txt") do (
    if exist "%%P" (
        rmdir /s /q "%%P" 2>nul
        if exist "%%P" ( echo [WARN] Could not delete: "%%P" ) else ( echo [OK] Deleted: "%%P" )
    ) else (
        echo [SKIP] Not found \(already gone\): "%%P"
    )
)

echo.
echo [DONE] Residue cleanup finished.
echo        You may now unplug the USB drive.
pause
