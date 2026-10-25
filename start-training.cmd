@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\training\start.ps1" %*
if errorlevel 1 pause
