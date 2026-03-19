@echo off
setlocal
cd /d "%~dp0"

echo Opening local premium entry window...
powershell -NoProfile -ExecutionPolicy Bypass -Sta -File "scripts\manual-premium-entry.ps1"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
	echo.
	echo Launcher failed with exit code %EXIT_CODE%.
	pause
)

endlocal & exit /b %EXIT_CODE%
