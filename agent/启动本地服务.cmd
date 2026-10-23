@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 or newer is required. Install it, then reopen this file.
  pause
  exit /b 1
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)"
if errorlevel 1 (
  echo Your Node.js version is too old. Please install Node.js 24 or newer.
  pause
  exit /b 1
)
echo Starting My0511 Agent. Keep this window open. Press Ctrl+C to stop.
node server.mjs
set "agent_exit=%errorlevel%"
echo My0511 Agent has stopped. You may close this window.
pause
exit /b %agent_exit%
