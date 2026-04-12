# User Guide

This guide explains how to use Streamlate as a translator or listener.

## For Translators

### Logging In

1. Open the Streamlate translation client in your browser (e.g., `https://streamlate.example.com`)
2. Enter your email and password
3. Click **Login**

Your credentials are provided by the system administrator. If you don't have an account, contact your admin.

### Starting a Translation Session

1. After logging in, you'll see the **Dashboard** with available audio booths
2. Select a booth that shows as **Online** (green indicator)
3. Click **Start Session**
4. Enter a session name (e.g., "Plenary - Spanish") and optional PIN for listener access
5. Click **Create**

### Translating

Once the session starts:

- **Source audio** from the booth plays through your headphones/speakers
- The **VU meter** shows the incoming audio level
- Your **microphone** captures your translation and sends it to listeners
- The outgoing VU meter shows your translation audio level

### Audio Controls

| Control | Function |
|---------|----------|
| **Mute** | Stops sending your translation to listeners (source audio continues) |
| **Passthrough** | Sends the booth source audio directly to listeners instead of your translation |
| **Volume** | Adjusts the level of the source audio you hear |

### Ending a Session

Click **End Session** to stop the translation. The recording is automatically saved and available in the session history.

### Session Health

During an active session, you can monitor connection quality:
- **Latency**: Round-trip time to the server
- **Packet loss**: Percentage of audio packets lost
- **Bitrate**: Current audio bitrate

## For Listeners

### Joining a Session

There are two ways to join:

#### Via Direct Link
If you received a link (e.g., from a QR code), simply open it in your browser. You may be asked for a PIN if the session is protected.

#### Via Session Picker
1. Open the listener client (`https://streamlate.example.com/listen`)
2. Browse active sessions
3. Click on the session you want to join
4. Enter the PIN if required

### Listening

Once connected:
- The translated audio plays automatically
- Use the **volume control** to adjust the audio level
- The **VU meter** shows the incoming audio level
- The connection indicator shows your link quality

### Troubleshooting

| Issue | Solution |
|-------|----------|
| No audio | Check that your browser allows audio autoplay; click anywhere on the page |
| Audio cuts out | Check your internet connection; the client will automatically reconnect |
| "Invalid PIN" | Ask the translator or organizer for the correct PIN |
| High latency | Move closer to your Wi-Fi router or use a wired connection |

## Browser Requirements

Streamlate works in modern browsers that support WebRTC:

| Browser | Supported |
|---------|-----------|
| Chrome / Chromium 90+ | ✅ |
| Firefox 85+ | ✅ |
| Safari 15+ | ✅ |
| Edge 90+ | ✅ |
| Mobile Chrome (Android) | ✅ |
| Mobile Safari (iOS 15+) | ✅ |

**Note**: For translators, a desktop browser is recommended for the best experience. Listeners can use mobile browsers.

## Tips for Best Quality

### For Translators
- Use a good quality headset with a microphone
- Ensure a stable internet connection (wired preferred)
- Close other applications that might use the microphone
- Test your audio setup before starting a session

### For Listeners
- Use headphones for the best experience
- If using speakers, keep volume reasonable to avoid echo
- A stable internet connection ensures uninterrupted audio
