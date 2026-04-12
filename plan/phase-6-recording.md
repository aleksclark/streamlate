# Phase 6: Recording & Playback

**Goal**: Sessions are recorded as Ogg/Opus files. Recordings survive crashes. Playback in the translation client replays both tracks in sync.

**Duration**: ~1.5 weeks

**Depends on**: Phase 3, Phase 4 (sessions work end-to-end)

## Steps

### 6.1 Ogg/Opus Writer

- Implement an Ogg page writer in Rust:
  - Wraps raw Opus packets into Ogg pages
  - Writes pages to a file
  - Maintains granule position (timestamp) for each page
  - Flushes to disk every ~50 pages (~1 second of audio)
  - Calls `fsync()` on configurable interval
- Use the `ogg` crate (or minimal custom implementation)

No transcoding — Opus packets come directly from the WebRTC track's RTP payloads (strip RTP header, write Opus payload to Ogg).

Verify: Writer produces valid `.ogg` files playable with `ffplay` or VLC.

### 6.2 Session Recorder

- When a session transitions to `active`:
  1. Create recording directory: `/var/lib/streamlate/recordings/{session_id}/`
  2. Create `source.ogg` writer (fed from ABC's source track)
  3. Create `translation.ogg` writer (fed from translator's track)
  4. Create `metadata.json` with session info (started_at, names, etc.)
  5. Insert `recordings` row in database
- Recorder runs as a `tokio` task, receives Opus packets via channel
- On each RTP packet received by the SFU, clone and send to recorder

Verify: After ending a session, two `.ogg` files exist and are playable.

### 6.3 Event Logging

Track session events in `metadata.json`:

```json
{
  "events": [
    { "time": 0.0, "type": "session_start" },
    { "time": 120.5, "type": "mute", "value": true },
    ...
  ]
}
```

Events to capture:
- `session_start` / `session_end`
- `mute` / `unmute`
- `passthrough_on` / `passthrough_off`
- `reconnect` (ABC or translator)

Write `metadata.json` incrementally (append events, rewrite file) or use a `.jsonl` format for append-only during recording, then finalize to JSON on stop.

Verify: Metadata contains all events with correct timestamps.

### 6.4 Session Finalization

When session stops:
1. Flush and close both Ogg writers
2. Update `metadata.json` with `ended_at`, `duration_seconds`
3. Calculate `size_bytes` (sum of both files)
4. Update `recordings` table with duration and size
5. Update session state to `completed`

Verify: Recording metadata matches actual file duration.

### 6.5 Crash Recovery

On server startup:
1. Scan recording directory for sessions without `ended_at`
2. For each incomplete recording:
   - Read last Ogg granule position to determine recovered duration
   - Update `metadata.json` with recovered info, state = `failed`
   - Update database records
3. Log recovered sessions at `warn` level

Verify: Kill server mid-session (`kill -9`). Restart. Recording is available with correct duration.

### 6.6 Recording REST API

Implement endpoints:

- `GET /api/v1/recordings` — list recordings (paginated, filterable by date/session)
- `GET /api/v1/recordings/{id}` — metadata
- `GET /api/v1/recordings/{id}/source` — stream source .ogg file
- `GET /api/v1/recordings/{id}/translation` — stream translation .ogg file
- `DELETE /api/v1/recordings/{id}` — delete recording files + DB record (admin only)

File streaming: use `axum::body::Body::from_stream()` for efficient streaming of large files.

Verify: Can list recordings, download files, delete recordings.

### 6.7 Playback UI

In the Translation Client, add a "Recordings" page:

- List of recordings with:
  - Session name
  - Translator name
  - Date/time
  - Duration
  - Size
- Click to open playback view

Playback view:
- Two `<audio>` elements (or Web Audio API sources) for source and translation
- Synchronized playback (both start at the same offset)
- Independent volume controls for each track
- Timeline scrubber (seeking both tracks together)
- Playback speed: 0.5×, 1×, 1.5×, 2×
- Visual markers on timeline for mute/passthrough events
- Play/pause button

Synchronization approach:
- Both audio files share the same time origin
- On seek, set `currentTime` on both elements
- Use `requestAnimationFrame` to keep timeline indicator in sync

Verify: Playback is synchronized, volume controls work independently, seeking works.

### 6.8 Storage Management

- Show disk usage in admin stats (`GET /api/v1/system/stats`)
- Bulk delete (admin can select multiple recordings)
- Future: configurable retention policy (auto-delete after N days)

Verify: Admin can see storage usage and delete recordings.

## Definition of Done

- [ ] Sessions produce two valid .ogg files
- [ ] Recording survives server crash (kill -9 test)
- [ ] Metadata includes all session events
- [ ] REST API for listing, downloading, deleting recordings
- [ ] Playback UI with synchronized dual-track audio
- [ ] Volume controls, seeking, speed control work
- [ ] Mute/passthrough events visible on timeline
- [ ] **E2E validation gate passes** (see below)

## Validation Gate: E2E Tests

These tests prove recordings contain real audio, survive crashes, and play back correctly. The SIGKILL test is the centerpiece.

```
e2e/tests/phase-6/
  ├── recording.spec.ts
  ├── crash-recovery.spec.ts
  └── playback.spec.ts
```

| Test | What It Proves |
|------|----------------|
| After session ends, `GET /recordings` lists it with duration > 0 | Recording was created |
| Download `source.ogg` → valid Ogg/Opus, duration within 2s of session length | Real audio was written |
| Download `translation.ogg` → same validation | Both tracks recorded |
| Decode `source.ogg` offline → detect 440 Hz (ABC's sine wave) | Recorded audio has correct content, not silence |
| Decode `translation.ogg` offline → detect 880 Hz (translator's sine) | Both tracks have correct content |
| Mute at T≈5s, unmute at T≈10s → `metadata.json` has mute events near those times | Events are timestamped and real |
| **SIGKILL server mid-session** → restart → recording exists in API | Crash recovery ran |
| Recovered recording's `.ogg` files are valid Ogg/Opus | Files aren't truncated/corrupt |
| Recovered recording duration > 0 (at least partial audio recovered) | Incremental flush worked |
| Playback UI: click play → audio plays from both tracks | Playback wired to real files |
| Playback UI: seek to 50% → both `<audio>` elements' `currentTime` update | Sync is real, not cosmetic |
| `DELETE /recordings/{id}` → files removed from disk, API returns 404 | Deletion is real |

**Offline audio decoding**: Tests download the `.ogg` files, then either:
- Use `ffprobe` in a Docker sidecar to validate format and detect frequency, or
- Decode in the browser test via Web Audio API `decodeAudioData` and run FFT

The **SIGKILL test** (`docker kill --signal=KILL server`) is the hardest to fake — it proves the Ogg writer's incremental flush strategy actually works under sudden process termination.
