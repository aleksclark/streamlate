#!/bin/bash
set -euo pipefail

echo "Loading ALSA loopback kernel module with 2 subdevices..."
sudo modprobe snd-aloop pcm_substreams=2

echo ""
echo "ALSA loopback loaded. Devices:"
aplay -l 2>/dev/null | grep -A1 Loopback || echo "(no Loopback devices found — check 'lsmod | grep snd_aloop')"

# Disable PipeWire/WirePlumber's claim on the loopback card.
# PipeWire auto-detects the loopback card and opens its PCM devices,
# blocking direct ALSA access from Docker containers.
if command -v wpctl &>/dev/null; then
    LOOPBACK_ID=$(wpctl status 2>/dev/null | grep "Loopback.*\[alsa\]" | grep -oP '^\s*\K\d+' | head -1)
    if [ -n "$LOOPBACK_ID" ]; then
        echo ""
        echo "Disabling PipeWire profile for Loopback card (device $LOOPBACK_ID)..."
        wpctl set-profile "$LOOPBACK_ID" 0
        echo "Done — PipeWire will not hold the loopback devices."
    fi
fi

echo ""
echo "Subdevice mapping:"
echo "  plughw:Loopback,0,0  <-->  plughw:Loopback,1,0   (source audio path)"
echo "  plughw:Loopback,0,1  <-->  plughw:Loopback,1,1   (translated audio path)"
