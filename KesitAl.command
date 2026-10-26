#!/bin/bash
set -e

# Proje çalışma dizinine geç
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# Homebrew ve sistem binary yollarını ekle
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

PORT=3847
URL="http://localhost:${PORT}"

echo "=================================================="
echo "           🎬 KesitAl - Video Kırpıcı            "
echo "=================================================="

# Port 3847 kontrolü (çalışıyorsa doğrudan tarayıcıyı aç ve çık)
if lsof -i :${PORT} > /dev/null 2>&1 || curl -s "${URL}/api/health" > /dev/null 2>&1; then
    echo "⚡ KesitAl sunucusu zaten çalışıyor (${URL})."
    echo "🌐 Tarayıcı açılıyor..."
    open "${URL}"
    exit 0
fi

echo "🚀 Sunucu başlatılıyor (${URL})..."

# Arka planda sunucunun hazır olmasını bekle ve tarayıcıyı aç
(
    ATTEMPTS=0
    MAX_ATTEMPTS=30
    until curl -s "${URL}/api/health" > /dev/null 2>&1 || [ $ATTEMPTS -ge $MAX_ATTEMPTS ]; do
        sleep 0.5
        ATTEMPTS=$((ATTEMPTS + 1))
    done

    if [ $ATTEMPTS -lt $MAX_ATTEMPTS ]; then
        echo "✅ Sunucu hazır! Tarayıcı açılıyor..."
        open "${URL}"
    else
        echo "⚠️ Sunucu zamanında yanıt vermedi, yine de açılmayı deneniyor..."
        open "${URL}"
    fi
) &

# Sunucuyu çalıştır
npm start
