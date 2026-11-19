#!/usr/bin/env bash
# Jalankan Alinkvault di perangkat ini lewat browser.
# Pemakaian: ./serve.sh [port]
set -e
cd "$(dirname "$0")"
PORT="${1:-8090}"
echo "Alinkvault berjalan di http://localhost:${PORT}"
echo "Tekan Ctrl+C untuk berhenti."
exec python3 -m http.server "$PORT" --bind 127.0.0.1
