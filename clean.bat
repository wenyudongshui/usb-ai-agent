@echo off
setlocal EnableExtensions
chcp 65001 >nul
title USB AI Agent - cleanup

rem ============================================================
rem  clean.bat — one-click cleanup of host residue
rem
rem  Deletes only what the app itself recorded in data\keys\cache_path.txt
rem  (its own cache dirs / host workspace cache). Never touches pagefiles
rem  or system logs. Run after quitting the app, before unplugging.
rem  NOTE: if PORTABLE_AI_DATA_DIR was overridden at runtime, clean there.
rem ============================================================

set "DRIVE=%~d0"
set "CFGPATH=%DRIVE%\data\keys\cache_path.txt"

if not exist "%CFGPATH%" (
    echo [INFO] No cache_path.txt found - nothing to clean.
    pause
    exit /b 0
)

echo Cleaning recorded cache paths from %CFGPATH% ...
echo.

for /f "usebackq delims=" %%P in ("%CFGPATH%") do (
    if exist "%%P" (
        rmdir /s /q "%%P" 2>nul
        if exist "%%P" ( echo [WARN] Could not delete: "%%P" ) else ( echo [OK] Deleted: "%%P" )
    ) else (
        echo [SKIP] Not found ^(already gone^): "%%P"
    )
)

echo.
echo [DONE] Residue cleanup finished.
echo        You may now unplug the USB drive.
pause