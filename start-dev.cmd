@echo off
setlocal
title Idea2Screenplay Development Launcher
cd /d "%~dp0"

where.exe pwsh.exe >nul 2>nul
if errorlevel 1 goto windows_powershell

pwsh.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-dev.ps1"
goto finished

:windows_powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-dev.ps1"

:finished
set "launcher_exit=%errorlevel%"
if "%launcher_exit%"=="0" exit /b 0

echo.
echo The launcher failed. Review the error above, then press any key to close.
pause >nul
exit /b %launcher_exit%
