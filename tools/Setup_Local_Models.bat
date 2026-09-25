@echo off
setlocal
chcp 65001 >nul
title USB AI Agent - Local Model Setup
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup_local_models.ps1"
pause