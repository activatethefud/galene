# AGENTS.md

Working notes for agents (and humans) editing this repository.  This is a
shallow clone of [Galene](https://github.com/jech/galene) v1.2
(HEAD `38fda0a`) that we use as a scratch copy to experiment with the
client UI.  Only files under `static/` (HTML/CSS/JS) plus the root
`package.json`, `.gitignore`, and `static/test/` have been touched; the
Go server code is upstream and unmodified.

## What this project is

Galene is a pure SFU (Selective Forwarding Unit).  The server never
decodes or mixes media; audio/video is forwarded as-is.  Consequently all
audio processing (echo cancellation, noise suppression, mute handling)
is client-side only.  Do not look for server-side AEC or mixing.

## Key files

- `static/galene.html` — the group/room page (login screen, top nav, video
  tiles, user list).  All client scripts are loaded here as classic
  `<script defer>` tags in a fixed order (protocol, settings, filter,
  camera-test, galene).
- `static/galene.js` — main client logic (~4600 lines).  Scripts share one
  global scope: top-level `function` declarations and `let`/`const` are
  visible across files.
- `static/protocol.js` — `ServerConnection` and `Stream` classes
  (WebSocket protocol + WebRTC).
- `static/settings.js` — `getSettings`/`updateSettings`/`delSetting` backed
  by `sessionStorage` key `'settings'`.  No defaults are applied here;
  `reflectSettings()` in galene.js defaults missing fields from the DOM.
- `static/camera-test.js` — the "Test camera and microphone" `<details>`.
- `static/galene.css` / `static/common.css` — styling.
- `static/tsconfig.json` — type-checks `galene.js` and friends (strict-ish,
  `noUnusedLocals`, `noImplicitReturns`).  The `files` list intentionally
  excludes `static/test/**`.

## Local media / Mic & Camera toggles (important invariants)

The client exposes Jitsi-style **Mic** and **Camera** toggle buttons, both
on the login/Connect screen (live preview) and in the room top bar
(`#mutebutton`, `#cambutton`).

- `localCameraOn` / `localMicOn` (module-level `let`s in galene.js) are the
  single source of truth for desired media state.  They now **default to
  `true`**, so on page load a live preview starts automatically.
- Local media presence == an up-stream labelled `'camera'`.  The stream is
  opened/closed via `openLocalMedia(localId, videoOn)`; reconciliation
  happens in `adjustLocalMedia()`.
- Mic "off" means a muted (disabled) audio track, not the absence of one,
  so unmuting mid-call is instant.
- `toggleMicrophone()` / `toggleCamera()` decide between the in-room path
  (`adjustLocalMedia`) and the login path (`updateLoginPreview`) by
  `inRoom()` (socket open AND login container hidden).
- `syncMediaButtons()` refreshes all four toggle-button icon states from
  the two flags and is the single funnel for UI sync.
- Mic-mute state is shared with the rest of the group via a per-user data
  broadcast: `broadcastMute(muted)` sends
  `userAction('setdata', own id, {'muted': muted})`; receivers re-render the
  row in `setUserStatus()`.
- Each participant-list row (in `setUserStatus()`, galene.js) shows an
  initials avatar circle (`.user-avatar`), the name
  (`.user-status-name`), and Mic/Camera icons (`.user-status-icon`) that
  mirror the top-bar toggles: green `fa-microphone` when the user is
  audible, red `fa-microphone-slash` (`.user-status-off`) when muted or
  off, and `fa-video`/`fa-video-slash` for the camera.  The old single
  glyph classes `user-status-muted/-microphone/-camera` are gone; only
  `user-status-raisehand` (a badge on the avatar) remains.
- Tiles for a user whose camera is off but mic is on show a generated
  avatar (initials, see `getInitials()`/`setAvatarText()`) instead of a
  black canvas: `showHideMedia()` reveals `.avatar` inside the `.peer`
  tile when a stream has no video track.
- A floating "on-air" pill `#air-indicator` (bottom-center, animated dot)
  shows while `localMicOn || localCameraOn` **and** `inRoom()`.
- `gotClose()` resets the toggles to `true` and restarts the login preview,
  so the user arrives back at the Connect screen with media on.
- Operator remote-mute (`case 'mute'`) and the auto-mute when playing a
  file set `localMicOn = false` too.

## User convenience features

- Login username is remembered in `localStorage` (`galene.username`) and
  pre-filled (`getStoredUsername`/`setStoredUsername`); the trimmed value is
  stored on login submit.
- Mic/camera toggle state is remembered in `localStorage` (`galene.media`,
  `{camera, mic}` booleans): `toggleMicrophone()`/`toggleCamera()` persist
  after flipping; `gotClose()` and `start()` restore the last chosen state
  (defaulting to both on when nothing is stored) so auto-login/rejoin
  starts the way the user left it.
- Password automatic login stores `{username, password, time}` under
  `galene.login` (`LOGIN_TTL` = 24h of inactivity).  Credentials are only
  persisted after a *confirmed* join (`pendingLogin`), cleared on explicit
  logout and on a rejected login (`'fail'` join message), and survive
  ordinary disconnects.
- Invite-link (token) automatic login stores `{group, token, username,
  time}` under `galene.invite` (same 24h `LOGIN_TTL`).  It exists so users
  who arrive through an invite URL and log in by typing **only a
  username** (no password) are recognised again on later visits:
  - `getStoredInvite(group)` returns the record only for the *current*
    group (a foreign-group entry is kept, not cleared) and only if not
    expired (expired entries are cleared); `setStoredInvite` /
    `clearStoredInvite` do what their names say.
  - `pendingInvite` mirrors `pendingLogin`: capture in `join()` for a real
    token join (not the probe) that has a username; persist in `gotJoined`
    only on a confirmed `'join'`; wipe on rejection (a revoked/rejected
    token in the `'fail'` branch clears the stored invite so the user does
    not loop).
  - In `start()`'s no-token branch a fresh stored invite for the current
    group is preferred over the password auto-login: it prefills the
    username, hides the password form, sets `token` +
    `probingState='need-username'` (so `join()` skips the probe and does
    the real join at once), then `serverConnect()`; if the socket never
    opens it falls back to `showLogin()`.
  - `gotClose()` restores the stored token after a disconnect so clicking
    Connect again rejoins with just the username.
- **Logout semantics:** `#logoutbutton` (top bar) and the sidebar
  `#disconnectbutton` close the connection and drop the remembered
  *password* credentials (`galene.login`), but they deliberately KEEP the
  invite token (`galene.invite`).  An invited user who only ever types a
  username must be able to log back in — and rename themselves — without a
  fresh invite link.  After logout `gotClose()` therefore restores the
  stored token (`probingState='need-username'`, username pre-filled, the
  password form hidden); `loginform.onsubmit` only shows the password
  field for password-based logins (`if(!token)`), so token users are never
  bounced back to the full auth form.
- Operator can mute a participant from the user menu.
- Operator can mute a participant from the user menu.

## Running the client tests

Node >= 18 is required (tests use the built-in `node:test` runner and
`jsdom`).  Tests load the *real* `static/galene.html` and real deferred
scripts inside JSDOM, stubbing only what JSDOM lacks (fetch for
`.status`, `matchMedia`, `mediaDevices`, `AudioContext`, canvas 2D,
`HTMLMediaElement.play`).

```sh
npm install      # installs jsdom (already done; node_modules is gitignored)
npm test         # = node --test static/test/*.test.js
```

Files: `static/test/harness.js` (shared `loadApp` + stubs), and the test
suites in `static/test/*.test.js`.  `loadApp(opts)` waits for the login
screen **and** the auto-started media preview before resolving, so the
initial state is deterministic (both toggles ON, one getUserMedia call).
`userlist.test.js` renders participant rows by calling `setUserStatus()`
directly on a detached element, so no WebSocket/RTC plumbing is needed.
`invite-flow.test.js` drives the real protocol end-to-end through the
scriptable fake WebSocket: set `opts.url` to a `?token=...` page and
`opts.webSocket: true`, then use `window.__sockets` + the per-socket
`serverOpen()`/`serverSend(obj)`/`close()` driver methods to reply to the
client's handshake (`{type:'handshake',version:['2']}`) and `join`
messages (`{type:'joined',kind:'fail'|'join',...}`).  Because jsdom has no
`RTCPeerConnection`, scripted joins grant permissions **without**
`'present'` so the auto-present/media path is skipped.  After driving an
action that closes the socket (e.g. logout), always `waitFor` the login
screen — the fake socket's `onclose` is asynchronous, and asserting or
`app.close()`ing before it settles leaks a timer.

Note for tests: because `start()` calls `enumerateDevices` + 
`reflectSettings`, the enumerated default device ids (`cam1`, `mic1` in the
harness) get persisted into settings — audio/video constraints are always
`{deviceId: ...}` objects, never the boolean `true`.

## Type checking

`static/tsconfig.json` is used upstream to type-check the classic client
scripts.  The `tsc` binary is not installed in this environment; if
available run:

```sh
npx tsc -p static/tsconfig.json
```

Watch out for `noUnusedLocals` and `noImplicitReturns` — every declared
local must be used and non-void functions must return on all paths.

## Running the local server (manual testing)

```sh
./galene -insecure -http :8443 -groups ./groups -data ./data -static ./static
```

The binary is the upstream Go build (go 1.24 installed).  Test group
`groups/test.json` (gitignored): any username + password `1234` joins with
`present` permission; username `op` + `1234` is the operator.  Open
`http://localhost:8443/group/test/`.

Background/restart:

```sh
nohup ./galene -insecure -http :8443 -groups ./groups -data ./data \
    -static ./static > /tmp/galene.log 2>&1 &
pkill -f './galene'   # stop
```

## Git hygiene

- Group files under `groups/**/*.json`, `data/`, compiled artifacts,
  `static/**/*.d.ts`, `node_modules/`, and `package-lock.json` are
  gitignored — never commit secrets or local state.
- Commit logically-grouped, reviewable chunks; keep upstream files pristine
  unless a change is intended for the Galene project.
