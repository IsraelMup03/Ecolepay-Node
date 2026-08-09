@echo off
setlocal
set ROOT=%~dp0

REM Backend
cd /d "%ROOT%backend"
start "EcolePay Backend" cmd /k "npm start"

timeout /t 2 /nobreak >nul

REM Frontend
cd /d "%ROOT%frontend"
start "EcolePay Frontend" cmd /k "npm run dev"

timeout /t 5 /nobreak >nul

REM Ouvre le navigateur sur la page frontend
start "" "http://localhost:5173"
endlocal
