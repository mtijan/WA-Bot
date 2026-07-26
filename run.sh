#!/bin/bash

echo "==================================================="
echo "      MENYALAKAN SISTEM S-BRO MULTI-ACCOUNT        "
echo "==================================================="
echo ""

if [ -f "backend/.env" ]; then
  echo "[Config] Menggunakan backend/.env lokal. Nilai environment proses tetap memiliki prioritas."
elif [ ${#WA_BOT_SECRET_ENCRYPTION_KEY} -lt 32 ]; then
  echo "[ERROR] WA_BOT_SECRET_ENCRYPTION_KEY wajib diisi minimal 32 karakter."
  echo "Gunakan nilai yang sama pada setiap restart agar sesi WhatsApp dapat didekripsi."
  exit 1
fi

# Menjalankan Backend di background
echo "[+] Menjalankan server Backend..."
cd backend && npm start > /dev/null 2>&1 &
BACKEND_PID=$!
cd ..

# Menjalankan Frontend di background
echo "[+] Menjalankan server Frontend..."
cd frontend && npm run dev > /dev/null 2>&1 &
FRONTEND_PID=$!
cd ..

echo ""
echo "==================================================="
echo "[!] Sistem berhasil dinyalakan!"
echo "[!] Frontend : http://localhost:5173"
echo "[!] Backend  : http://localhost:3001"
echo "[!] Tekan Ctrl+C untuk mematikan kedua server."
echo "==================================================="
echo ""

# Perangkap sinyal Ctrl+C untuk mematikan proses background
trap "echo -e '\n[+] Mematikan server...'; kill $BACKEND_PID $FRONTEND_PID; exit" INT

# Menjaga skrip tetap berjalan
wait
