# Recording & Playback

Every active session is recorded. The recording captures both the source audio (from the ABC) and the translated audio (from the translator) as separate tracks, preserving their temporal relationship for synchronized playback.

## Design Goals

1. **Crash-resilient**: If the server crashes mid-session, all audio recorded up to that point is recoverable
2. **Low overhead**: Recording must not add measurable latency to the live session
3. **Synchronized playback**: Source and translation can be played back in sync, exactly as they were during the live session
4. **Streamable**: No post-processing required — files are valid from the first written byte

## Recording Format

### File Structure

Each session produces a directory:

```
/var/lib/streamlate/recordings/
  └── {session_id}/
      ├── metadata.json
      ├── source.ogg        # Source audio from ABC
      └── translation.ogg   # Translated audio from translator
```

### Why Ogg/Opus

| Requirement | How Ogg/Opus satisfies it |
|-------------|--------------------------|
| Crash-resilient | Ogg pages are independently decodable; file is valid after every page flush |
| No transcoding | WebRTC already uses Opus; we wrap raw Opus packets in Ogg container |
| Streamable | Ogg is a streaming container by design |
| Low overhead | No encoding — just containerization |
| Standard tooling | Playable in every browser, VLC, ffmpeg |

### Write Strategy

```
WebRTC Opus packet received
  │
  ├─ Forward to subscribers (live)
  │
  └─ Write to Ogg file
       ├─ Wrap packet in Ogg page
       ├─ Write page to file
       └─ fsync() every N pages (configurable, default: every 50 pages / ~1 second)
```

- Pages are flushed frequently so minimal data is lost on crash
- `fsync()` interval is tunable: more frequent = more crash-safe, less frequent = lower I/O overhead
- Each Ogg page has a granule position (timestamp), so playback can seek without an index

## Metadata

```json
{
  "session_id": "7c9e6679-...",
  "session_name": "Main Hall — Spanish",
  "translator_id": "a1b2c3d4-...",
  "translator_name": "Maria Rodriguez",
  "abc_id": "550e8400-...",
  "abc_name": "Main Hall — Booth A",
  "started_at": "2025-01-15T10:30:00Z",
  "ended_at": "2025-01-15T12:00:00Z",
  "duration_seconds": 5400,
  "source_file": "source.ogg",
  "translation_file": "translation.ogg",
  "state": "completed",
  "events": [
    { "time": 0.0, "type": "session_start" },
    { "time": 1800.5, "type": "mute", "value": true },
    { "time": 1815.2, "type": "mute", "value": false },
    { "time": 3600.0, "type": "passthrough", "value": true },
    { "time": 3660.0, "type": "passthrough", "value": false },
    { "time": 5400.0, "type": "session_end" }
  ]
}
```

The `events` array records mute/passthrough transitions so playback can replicate the live experience.

## Synchronized Playback

Both `.ogg` files share the same time origin (the session start). To play back in sync:

1. Client fetches both files and metadata
2. Creates two `<audio>` elements (or Web Audio sources)
3. Starts playback of both at the same time offset
4. Applies events from metadata (mute/passthrough) at the correct timestamps

The Translation Client's recording playback view provides:

- Independent volume controls for each track
- Timeline scrubber (seeking both tracks in lockstep)
- Playback speed control (0.5×–2×)
- Visual mute/passthrough markers on the timeline

## Storage Management

| Concern | Approach |
|---------|----------|
| Disk usage | ~15 MB/hour per track at 32 kbps Opus → ~30 MB/hour per session |
| Retention | Configurable retention policy (default: keep forever, manual delete) |
| Cleanup | Admin can delete recordings via API or UI |
| Future | Storage adapter trait allows plugging in S3-compatible backends |

## Recovery After Crash

If the server process crashes:

1. On restart, scan recording directory for sessions without `ended_at` in metadata
2. Mark those sessions as `failed`
3. The `.ogg` files are still valid up to the last flushed page
4. Update metadata with recovered duration from the Ogg file's last granule position
5. Recordings are available for playback despite the crash
