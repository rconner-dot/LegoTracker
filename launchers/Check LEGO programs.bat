@echo off
rem Drag .llsp3 files (or a folder of them) onto this file to check them.
setlocal
title Class Quest - check LEGO programs
set "NODE=%~dp0node\node.exe"
if not exist "%NODE%" set "NODE=node"
"%NODE%" "%~dp0scripts\check-llsp3.js" %*
echo.
pause
