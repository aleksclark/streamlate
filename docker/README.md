# Docker Compose Stack with ALSA Loopback

Run the full Streamlate stack locally with real audio I/O via ALSA loopback devices.

## Architecture

```
┌────────────────┐     hw:Loopback,0,0        hw:Loopback,1,0     ┌──────────────┐
│  audio-bridge  │──── write PCM ────────────► capture PCM ────────│     ABC      │
│  (ffmpeg/aplay)│     (source audio)          (→ Opus → WebRTC)   │              │
│                │                                                  │              │
│                │     hw:Loopback,1,1        hw:Loopback,0,1      │              │
│                │◄─── read PCM ◄──────────── write PCM ◄──────────│              │
│                │     (translated audio)      (WebRTC → Opus →)   │              │
└────────────────┘                                                  └──────┬───────┘
                                                                           │ WebRTC
                                                                           ▼
                                                                    ┌──────────────┐
                                                                    │    Server     │
                                                                    │  (SFU hub)   │
                                                                    └──────┬───────┘
                                                                           │ WebRTC
                                                              ┌────────────┴────────────┐
                                                              ▼                         ▼
                                                    ┌──────────────┐          ┌──────────────┐
                                                    │  Translation │          │   Listener   │
                                                    │    Client    │          │    Client    │
                                                    │  :3001       │          │  :3002       │
                                                    └──────────────┘          └──────────────┘
```

The `snd-aloop` kernel module creates virtual loopback pairs:
- **Subdevice 0** (source path): `hw:Loopback,0,0` ↔ `hw:Loopback,1,0`
- **Subdevice 1** (translated path): `hw:Loopback,0,1` ↔ `hw:Loopback,1,1`

## Prerequisites

- **Docker** and **Docker Compose** (v2)
- **Linux host** with kernel module support
- The `snd-aloop` kernel module (usually available in `linux-modules-extra`)

## Quick Start

### 1. Load the ALSA loopback module

```bash
./scripts/setup-loopback.sh
```

Or manually:

```bash
sudo modprobe snd-aloop pcm_substreams=2
```

### 2. Start the stack

```bash
docker compose up --build
```

Services:
| Service | URL | Description |
|---------|-----|-------------|
| server | http://localhost:8080 | Streamlate API + WebRTC SFU |
| translation-client | http://localhost:3001 | Translator web UI |
| listener-client | http://localhost:3002 | Listener web UI |
| abc | (internal) | Audio Booth Connector with ALSA |
| audio-bridge | (internal) | Utility container for audio I/O |

### 3. Play source audio

Place an MP3 (or any audio file) in the project directory, then:

```bash
./scripts/play-source.sh path/to/input.mp3
```

This streams the audio into the ABC's capture input via the loopback device.

### 4. Record translated audio

```bash
./scripts/record-output.sh output.mp3
```

Press Ctrl+C to stop. The file is saved to `media/output.mp3`.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ABC_ID` | `booth-1` | ABC identity for server registration |
| `ABC_SECRET` | `sk_abc_dev` | ABC secret for authentication |
| `ABC_CAPTURE_DEVICE` | `hw:Loopback,1,0` | ALSA device for audio capture |
| `ABC_PLAYBACK_DEVICE` | `hw:Loopback,0,1` | ALSA device for audio playback |

## Troubleshooting

### "No default input device" or device not found

Ensure the loopback module is loaded:

```bash
lsmod | grep snd_aloop
```

If not loaded:

```bash
sudo modprobe snd-aloop pcm_substreams=2
```

### Permission denied on /dev/snd

The containers need access to `/dev/snd`. The compose file uses `devices` and `group_add: [audio]`. If you still get permission errors, try adding your user to the `audio` group:

```bash
sudo usermod -aG audio $USER
```

Or run with `privileged: true` in the compose file (not recommended for production).

### Module not available

Install the kernel modules package for your distribution:

```bash
# Ubuntu/Debian
sudo apt-get install linux-modules-extra-$(uname -r)

# Fedora
sudo dnf install kernel-modules-extra
```

### No audio flowing

1. Verify devices exist: `aplay -l | grep Loopback`
2. Check ABC logs: `docker compose logs abc`
3. Test the loopback manually:
   ```bash
   # Terminal 1: play a tone
   aplay -D hw:Loopback,0,0 -f S16_LE -r 48000 -c 1 /dev/urandom
   # Terminal 2: record from the paired device
   arecord -D hw:Loopback,1,0 -f S16_LE -r 48000 -c 1 -d 3 test.wav
   ```

### Making the loopback module persistent

To load `snd-aloop` automatically at boot:

```bash
echo "snd-aloop" | sudo tee /etc/modules-load.d/snd-aloop.conf
echo "options snd-aloop pcm_substreams=2" | sudo tee /etc/modprobe.d/snd-aloop.conf
```
