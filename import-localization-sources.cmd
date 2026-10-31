@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
node "%~dp0tools\localization\import-sources.mjs" %*
exit /b %errorlevel%
