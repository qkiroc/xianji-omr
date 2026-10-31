@echo off
setlocal
cd /d "%~dp0"
node -e "for (const p of ['next','antd','pg','sharp','express','embedded-postgres']) import.meta.resolve(p)" >nul 2>nul
if errorlevel 1 (
  echo Installing project dependencies...
  call npm ci --no-audit --no-fund
  if errorlevel 1 exit /b 1
)
node --watch --watch-path=server/src --watch-path=shared tools/dev/start.mjs
