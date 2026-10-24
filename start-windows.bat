@echo off
setlocal
cd /d "%~dp0"

echo.
echo ==========================================
echo          Ghost Bridge for Windows
echo ==========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js is not installed.
  echo Install Node.js 24 or newer from https://nodejs.org/en/download
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo ERROR: npm was not found. Reinstall Node.js 24 or newer.
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%A in ('node -p "process.versions.node"') do set NODE_MAJOR=%%A
if %NODE_MAJOR% LSS 24 (
  echo ERROR: Ghost Bridge requires Node.js 24 or newer.
  echo Your installed version is:
  node -v
  echo Install Node.js 24 or newer, then reopen this script.
  pause
  exit /b 1
)

if not defined PORT set PORT=3000

if not exist "node_modules\express\package.json" (
  echo Installing required packages. This can take several minutes...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo ERROR: Package installation failed. Copy the error shown above.
    pause
    exit /b 1
  )
)

echo.
echo Dashboard address: http://localhost:%PORT%
echo Keep this window open while using Ghost Bridge.
echo Press Ctrl+C in this window to stop it.
echo.
call npm start
if errorlevel 1 (
  echo.
  echo Ghost Bridge stopped with an error. Copy the error shown above.
  pause
)
