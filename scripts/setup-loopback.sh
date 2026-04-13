#!/bin/bash
set -euo pipefail

echo "Loading ALSA loopback kernel module with 2 subdevices..."
sudo modprobe snd-aloop pcm_substreams=2

echo ""
echo "ALSA loopback loaded. Devices:"
aplay -l 2>/dev/null | grep -A1 Loopback || echo "(no Loopback devices found — check 'lsmod | grep snd_aloop')"

echo ""
echo "Subdevice mapping:"
echo "  hw:Loopback,0,0  <-->  hw:Loopback,1,0   (source audio path)"
echo "  hw:Loopback,0,1  <-->  hw:Loopback,1,1   (translated audio path)"
