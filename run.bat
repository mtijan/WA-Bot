@echo off
title WA-Bot Launcher
echo ===================================================
echo       MENYALAKAN SISTEM WA-BOT MULTI-ACCOUNT       
echo ===================================================
echo.

echo [+] Membuka server Backend di jendela baru...
echo     Backend akan meminta password admin. Kosongkan jika ingin mode lokal tanpa login.
start "WA-Bot Backend" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0backend\scripts\start_with_admin_auth.ps1"

echo [+] Membuka server Frontend di jendela baru...
start "WA-Bot Frontend" cmd /k "cd /d ""%~dp0frontend"" && npm run dev"

echo.
echo ===================================================
echo [!] Sistem berhasil dinyalakan!
echo [!] Frontend : http://localhost:5173
echo [!] Backend  : http://localhost:3001
echo ===================================================
echo.
pause
