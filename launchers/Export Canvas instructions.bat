@echo off
setlocal
title Class Quest - export instructions
cd /d "%~dp0"
set "NODE=%~dp0node\node.exe"
if not exist "%NODE%" set "NODE=node"
"%NODE%" scripts\export-instructions.js %*
if not errorlevel 1 if exist "%~dp0instructions" start "" "%~dp0instructions"
echo.
pause
