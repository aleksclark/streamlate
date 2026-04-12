I want to create a spec for the following system: 
name: Streamlate 
Purpose: Simultaneous audio translation

# Components

1. Audio Booth Connector (ABC): raspberrypi or similar SBC, receives analog audio of the source feed and sends to server
via webrtc, receives translated feed over webrtc and emits analog audio of the translated feed
2. server: allows translators to connect to ABCs, and listeners to connect to hear the translated feed(s)
3. web translation/admin client: vite/react SPA used by translators, allows selecting a connected ABC and establishing a
session for translation, allows managing the system.
4. web listener client: vite/react SPA used to listen to translated streams, allows selecting a live session and
listening to the translated audio

# Component Details

## Audio Booth Connector

### Hardware
K2B Single Board Computer, Allwinner H618 Quad Core 64 Bit Development Board Up to 1.5GHz 2G LPDDR4 16G eMMC
2.4 Inches TFT LCD Touch Screen Shield Display Module 320x240 SPI Serial ILI9341

### Functionality
* auto-connects to network via wifi or ethernet
* auto-connects to server
* displays connection status on tft screen
* when a translation session is established, displays session status on tft screen
* uses webrtc for low latency audio
* resilient to network interruptions, reconnects as long as session active



## Server
* multiplexes webrtc audio
* tracks translator connections
* tracks ABC connections
* allows translation client to setup/stop sessions with a given ABC
* records translation sessions (source audio + translated audio)
* allows web listeners to listen to ongoing sessions
* sessions should persist until actually halted
* management REST API:
  * manage users (admins + translators)
  * manage recorded sessions
  * manage ABCs (api credentials, name)
  * manage public session endpoints

## Web Translation / admin Client
* list available ABCs for session setup
* set translator name
* connects to server via webrtc
* audio controls for incoming and outgoing streams, vu meters for feedback
* allows muting translation stream or sending the original stream (e.g. during music)
* displays channel health statistics
* mobile-friendly layout
* server management interface
* allows listening to recorded sessions as if they were live (original + translated streams, synced as they were during session)
* show QR code that can be scanned to launch web listener client for any currently active session

## Web Listener Client
* connects to server via webrtc, listening only
* allows selecting a session or getting launched with a url param that auto-connects to session
* while listening displays vu meter, volume controls, qr code for other users to listen

# Common
* Clean, minimalist look & feel for FE clients, use shadcdn, support light/dark mode (dark by default)
* Rust for server + ABC, server should provide a generated OpenAPI spec, FE clients do codegen to generate client packages
* server uses sqlite for persistence
* server session recording is streamed to disk in a format that will tolerate crashing
* DRY, modularity, separation of concerns
