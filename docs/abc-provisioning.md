# ABC Provisioning Guide

This guide covers the complete process of setting up an Audio Booth Connector (ABC) device for use with Streamlate.

## Overview

The ABC is a single-board computer (SBC) that bridges analog audio from a physical translation booth to the Streamlate server over WebRTC. It captures the booth's source audio, sends it to the server, and plays back translated audio from the translator.

**Target hardware**: Khadas VIM1S (K2B) or similar ARM64 SBC with:
- Analog audio I/O (line-in + line-out, or USB audio interface)
- Ethernet or Wi-Fi
- eMMC or SD card storage (≥4 GB)

## 1. Build the OS Image

### Base Image

Start with Armbian (Debian-based) for the target board:

```bash
# Download Armbian for your SBC model
# Example for Khadas VIM1S:
wget https://www.armbian.com/khadas-vim1s/

# Flash to SD card for initial setup
dd if=Armbian_*.img of=/dev/sdX bs=1M status=progress
```

### Install Dependencies

Boot the device and install required packages:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y \
    libasound2-dev \
    libssl-dev \
    ca-certificates \
    network-manager
```

### Install the ABC Binary

Cross-compile the ABC binary from your development machine:

```bash
# On development machine (requires aarch64 cross-compiler)
rustup target add aarch64-unknown-linux-gnu
cargo build --release -p streamlate-abc --target aarch64-unknown-linux-gnu

# Copy to device
scp target/aarch64-unknown-linux-gnu/release/streamlate-abc abc-device:/usr/local/bin/
```

Or build directly on the device (slower):

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
cargo build --release -p streamlate-abc
sudo cp target/release/streamlate-abc /usr/local/bin/
```

### Install systemd Service

```bash
sudo tee /etc/systemd/system/streamlate-abc.service << 'EOF'
[Unit]
Description=Streamlate ABC - Audio Booth Connector
After=network-online.target sound.target
Wants=network-online.target

[Service]
Type=simple
User=streamlate
Group=audio
ExecStart=/usr/local/bin/streamlate-abc --config /etc/streamlate/abc.toml
Restart=always
RestartSec=5
Environment=RUST_LOG=info

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable streamlate-abc
```

## 2. Register the ABC in Streamlate

Before configuring the device, register it in the Streamlate admin panel:

1. Log in to the Streamlate admin UI
2. Navigate to **Admin → ABCs → Add ABC**
3. Enter a name for the booth (e.g., "Booth 1 - Main Hall")
4. Click **Create** — the system generates an ABC ID and secret
5. **Copy both the ABC ID and secret** — the secret is shown only once

Alternatively, use the API:

```bash
# Create ABC via API (as admin)
curl -X POST https://streamlate.example.com/api/v1/abcs \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Booth 1"}'

# Response includes id and secret
```

## 3. Configure the Device

Create the configuration file on the ABC device:

```bash
sudo mkdir -p /etc/streamlate
sudo tee /etc/streamlate/abc.toml << EOF
[server]
url = "wss://streamlate.example.com/ws/abc"

[abc]
id = "YOUR_ABC_ID_HERE"
secret = "sk_abc_YOUR_SECRET_HERE"

[audio]
input_device = "default"
output_device = "default"
sample_rate = 48000
channels = 1

[network]
reconnect_interval_seconds = 5
EOF

sudo chmod 600 /etc/streamlate/abc.toml
```

### Audio Device Configuration

List available ALSA devices:

```bash
arecord -l   # List capture (input) devices
aplay -l     # List playback (output) devices
```

Set the correct device names in `abc.toml`:

```toml
[audio]
# Use "hw:X,Y" format or "default"
input_device = "hw:1,0"    # USB audio interface, device 1
output_device = "hw:1,0"
```

### Wi-Fi Configuration (if needed)

```bash
sudo nmcli device wifi connect "SSID" password "PASSWORD"
```

## 4. Test the Connection

Start the service and verify:

```bash
sudo systemctl start streamlate-abc

# Check status
sudo systemctl status streamlate-abc

# View logs
sudo journalctl -u streamlate-abc -f
```

Verify in the Streamlate admin panel:
1. Navigate to **Admin → ABCs**
2. The ABC should show as **Online** (green indicator)
3. Start a test session to verify audio flows

### Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| ABC stays offline | Wrong server URL or credentials | Check `abc.toml`, verify URL and secret |
| No audio captured | Wrong input device | Run `arecord -l`, update `input_device` |
| No audio playback | Wrong output device | Run `aplay -l`, update `output_device` |
| Intermittent disconnects | Network issues | Check Wi-Fi signal, prefer Ethernet |
| High latency | Network congestion | Use wired connection, check bandwidth |

## 5. Deploy in the Booth

### Physical Setup

```
┌─────────────────┐
│  Booth Mixer     │
│  Line Out ───────┼──► ABC Line In
│  Line In  ◄──────┼─── ABC Line Out
└─────────────────┘

ABC Line In  = Source audio from the booth
ABC Line Out = Translated audio back to booth (for monitoring)
```

1. Connect the booth mixer's **line out** to the ABC's **line in** (source audio)
2. Connect the ABC's **line out** to the booth's **headphone amp or PA** (translated audio)
3. Connect power (USB-C or barrel jack, depending on SBC)
4. Connect Ethernet if available (preferred over Wi-Fi for reliability)
5. Power on — the ABC starts automatically via systemd

### Verify End-to-End

1. Start a session from the translation client
2. Speak into the booth microphone
3. Verify the translator can hear the source audio
4. Verify the booth receives translated audio back

## 6. Create a Flashable Image (Optional)

For deploying multiple identical ABC devices, create a cloneable image:

```bash
# On the configured device, create an image
sudo dd if=/dev/mmcblk0 bs=1M | gzip > abc-image-v1.img.gz

# Flash to new devices
gunzip -c abc-image-v1.img.gz | sudo dd of=/dev/sdX bs=1M status=progress
```

After flashing, update the ABC ID and secret on each new device:

```bash
sudo nano /etc/streamlate/abc.toml
sudo systemctl restart streamlate-abc
```

## Security Notes

- The ABC secret (`sk_abc_*`) is equivalent to a password — protect it
- Config file permissions should be `600` (owner-only read/write)
- Use HTTPS/WSS for all server communication
- If a device is compromised, rotate the secret from the admin panel
- The ABC only needs outbound access to the server — no inbound ports required
