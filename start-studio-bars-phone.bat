@echo off
REM Studio Bars for your phone/tablet on the same Wi-Fi. Asks for a PIN (6+ characters) that the phone must enter.
REM NOT yet tested on Windows. Windows may ask to allow Python through the firewall: allow it for PRIVATE networks only.
setlocal
cd /d "%~dp0"
set /p STUDIO_BARS_ACCESS_PIN=Choose a PIN (6 or more characters): 
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\serve.ps1"
