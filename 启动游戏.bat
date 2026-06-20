@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo            XIAOLANGSHA  Launcher
echo ========================================
echo.

where npm >nul 2>nul
if errorlevel 1 (
  echo [X] npm not found. Please install Node.js first.
  echo     Download: https://nodejs.org/
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo [*] First run: installing dependencies, this may take a few minutes...
  call npm.cmd install
  if errorlevel 1 (
    echo.
    echo [X] Dependency install failed. Check network / npm config and retry.
    pause
    exit /b 1
  )
  echo.
)

if not exist ".env" (
  echo [!] No .env found: AI runs in scripted-fallback mode ^(still playable^).
  echo     For real LLM chat, create .env with AI_BASE_URL / AI_API_KEY.
  echo.
)

echo [*] Starting local server, browser will open automatically...
echo     Close this window to stop the game server.
echo.

call npm.cmd start

echo.
echo [*] Game server stopped.
pause
