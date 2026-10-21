@echo off
REM Doble clic aqui para: respaldar el intro-data.yaml y jalar los cambios de la nube.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0actualizar.ps1"
echo.
pause
