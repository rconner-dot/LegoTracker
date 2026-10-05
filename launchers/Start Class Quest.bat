@echo off
setlocal
title Class Quest
cd /d "%~dp0"

set "NODE=%~dp0node\node.exe"
if exist "%NODE%" goto run
where node >nul 2>nul
if errorlevel 1 goto nonode
set "NODE=node"

:run
"%NODE%" server.js --open %*
if errorlevel 1 (
  echo.
  echo  Class Quest stopped because of the problem shown above.
  echo.
  pause
)
exit /b

:nonode
echo.
echo  Class Quest can't find Node.js.
echo  Download the Windows zip of Class Quest (it has Node.js built in),
echo  or install Node.js from https://nodejs.org
echo.
pause
exit /b 1
