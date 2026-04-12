# Phase 7: Admin Panel & Polish

**Goal**: Full administration interface, QR codes, mobile layout polish, and UX refinements.

**Duration**: ~1.5 weeks

**Depends on**: Phase 3, Phase 4, Phase 6

## Steps

### 7.1 Admin Panel Layout

In the Translation Client, add admin-only routes under `/admin`:

```
/admin              → Admin dashboard (overview stats)
/admin/users        → User management
/admin/abcs         → ABC management
/admin/sessions     → Session management
/admin/recordings   → Recording management (enhanced from Phase 6)
/admin/settings     → System settings
```

- Sidebar or tab navigation
- Role check: redirect non-admins to translator dashboard
- Responsive: sidebar collapses to hamburger menu on mobile

Verify: Admin sees admin panel, translator sees only translator views.

### 7.2 User Management

- List all users (email, name, role, created date)
- Create new user form (email, name, password, role)
- Edit user (name, role, reset password)
- Delete user (with confirmation dialog)
- Cannot delete yourself
- Input validation matching server rules

Verify: Full CRUD lifecycle for users in the UI.

### 7.3 ABC Management

- List all ABCs:
  - Name
  - Status (online/offline/in-session — real-time via polling or WS)
  - Last seen timestamp
  - Created date
- Register new ABC:
  - Enter name
  - Server generates credentials
  - Show `abc_id` and `abc_secret` once (copyable, with warning)
- Edit ABC name
- Rotate secret (with confirmation — invalidates existing device)
- Delete ABC (with confirmation)

Verify: Can register ABC, see status, rotate credentials.

### 7.4 Session Management (Admin)

- List all sessions (active + completed + failed)
- Filter by state, date range
- Active sessions show:
  - Translator name
  - ABC name
  - Duration
  - Listener count
  - "Force Stop" button
- Force stop sends `POST /api/v1/sessions/{id}/stop` regardless of who owns it

Verify: Admin can see and force-stop any session.

### 7.5 Recording Management (Admin)

Enhance the recordings view from Phase 6:

- Bulk select + delete
- Search/filter by name, translator, date
- Download buttons for source and translation files
- Storage usage summary at top

Verify: Admin can manage recordings efficiently.

### 7.6 System Settings

- View current configuration (read-only for sensitive fields)
- Edit STUN/TURN server settings (write to config, restart signaling)
- View system stats:
  - Uptime
  - Active sessions count
  - Connected ABCs
  - Connected translators
  - Active listeners
  - Disk usage (recordings)
  - Database size

Verify: Stats display correctly, settings changes take effect.

### 7.7 QR Code Generation

- Generate QR codes on the client side (use `qrcode.react` or similar)
- QR code encodes the listener URL: `https://{host}/listen/{session_id}`
- Display QR code in:
  - **Translation session screen**: for the translator to show/share
  - **Listener view**: for listeners to help others connect
  - **Admin session list**: for each active session
- QR code should be:
  - Large enough to scan from 1-2 meters (conference setting)
  - High contrast (works in dark and light mode)
  - Downloadable as image (right-click save or "Download QR" button)

Verify: QR code scans correctly on phone, opens listener client.

### 7.8 Mobile Layout Polish

Review and refine all screens for mobile:

- **Translation session**: stack layout, large VU meters, big touch targets
- **Listener**: full-screen listening experience
- **Dashboard**: card-based layout for ABCs, scrollable
- **Admin**: responsive tables (horizontal scroll or card layout on small screens)
- Test on:
  - iPhone SE (375×667)
  - iPhone 14 Pro (393×852)
  - iPad (768×1024)
  - Android midrange (360×800)

Verify: All screens usable at 320px width minimum.

### 7.9 Theme & Branding

- Dark mode: default, clean dark background, accent colors for status indicators
- Light mode: clean white, same accent colors
- Theme toggle in header (persistent via localStorage)
- Streamlate logo/wordmark in header
- Consistent color system:
  - Green: online/active/connected
  - Red: in-use/error/recording
  - Grey: offline/inactive
  - Amber: reconnecting/warning
- Loading states: skeleton components, not spinners

Verify: Both themes look polished, no color contrast issues.

### 7.10 Notifications & Toasts

- Toast notifications for:
  - Session started/ended
  - Connection lost/restored
  - Error messages
  - Admin actions (user created, ABC registered, etc.)
- Use shadcn/ui Toast component
- Auto-dismiss after 5 seconds, dismissable on click

Verify: Actions produce appropriate feedback toasts.

## Definition of Done

- [ ] Admin panel with all management sections
- [ ] User CRUD in UI
- [ ] ABC management with status display
- [ ] Session oversight with force-stop
- [ ] Enhanced recording management
- [ ] System settings and stats
- [ ] QR codes work (generate, display, scan)
- [ ] Mobile layout polished on all screens
- [ ] Dark and light themes complete
- [ ] Toast notifications for all key actions
- [ ] **E2E validation gate passes** (see below)

## Validation Gate: E2E Tests

These tests verify that admin UI actions have real effects, not just visual feedback. The pattern is: perform action in UI → verify effect via a separate API call or separate browser context.

```
e2e/tests/phase-7/
  ├── admin-users.spec.ts
  ├── admin-abcs.spec.ts
  ├── admin-sessions.spec.ts
  ├── admin-recordings.spec.ts
  ├── qr-codes.spec.ts
  └── theme.spec.ts
```

| Test | What It Proves |
|------|----------------|
| Admin creates user in UI → new user logs in via separate browser context | User creation is wired to real API + DB |
| Admin deletes user → user's login attempt fails | Deletion is real, not just removing from list |
| Admin registers ABC in UI → ABC sim uses shown credentials to connect | ABC registration flow works end-to-end |
| Admin rotates ABC secret → old credential rejected, new one works | Secret rotation is real server-side operation |
| Admin force-stops session → translator and listener both see session end | Force-stop reaches all participants |
| Admin deletes recording → `GET /recordings/{id}` returns 404 | Deletion hits real API, not just UI state |
| QR code on session screen → decode QR image → URL is `/listen/{correct_session_id}` | QR encodes real URL, not placeholder |
| Navigate to decoded QR URL → listener hears audio | QR → listener full path works |
| Toggle theme → reload page → theme persists | localStorage persistence works |
| Non-admin navigates to `/admin` → redirected or 403 | Role gate is enforced |

**QR code decoding**: Tests capture a screenshot of the QR code element, decode it using a JS QR library (`jsQR`) in the test, and verify the URL contents.
