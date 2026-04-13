#!/bin/bash
set -euo pipefail

FILE=${1:?Usage: play-source.sh <file>}

if [ ! -f "$FILE" ]; then
    echo "Error: File '$FILE' not found"
    exit 1
fi

BASENAME=$(basename "$FILE")

docker compose cp "$FILE" audio-bridge:/media/"$BASENAME"

echo "Playing '$BASENAME' into ABC source input (hw:Loopback,0,0)..."
docker compose exec -T audio-bridge \
    ffmpeg -re -i "/media/$BASENAME" -f s16le -ar 48000 -ac 1 pipe:1 2>/dev/null | \
    docker compose exec -T audio-bridge \
    aplay -D plughw:Loopback,0,0 -f S16_LE -r 48000 -c 1

echo "Playback complete."
