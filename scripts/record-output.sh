#!/bin/bash
set -euo pipefail

FILE=${1:-output.mp3}

echo "Recording translated audio from ABC output (hw:Loopback,1,1)..."
echo "Press Ctrl+C to stop recording."

docker compose exec -T audio-bridge \
    arecord -D plughw:Loopback,1,1 -f S16_LE -r 48000 -c 1 2>/dev/null | \
    docker compose exec -T audio-bridge \
    ffmpeg -y -f s16le -ar 48000 -ac 1 -i pipe:0 "/media/$FILE" 2>/dev/null

echo "Saved to media/$FILE"
