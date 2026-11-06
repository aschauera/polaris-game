# Mobile, turn-based multiplayer

## Decision and delivered boundary

Polaris keeps one TypeScript rules engine and Babylon client. Android Chrome and iOS Safari use the same responsive, installable **PWA**. Online games use a **server-authoritative, asynchronous, alternating-turn** protocol: two invited players, one scout each, a fixed 24 x 24 world. Movement resolves immediately within the active player's budget; end-turn hands control to the opponent. This is multiplayer exploration, not the still-planned complete 4X economy/combat/victory loop.

An editable [architecture diagram](multiplayer-architecture.excalidraw) accompanies this decision.

No native Android/iOS binaries, store publication, paid hosting or public deployment are implied. Native packaging can reuse this client later, but signing, store review, accounts, push notifications and real-device certification are separate release work. A PWA avoids a premature engine rewrite and keeps the existing desktop atlas.

## Boundaries

| Component | Responsibility |
| --- | --- |
| `src/game` | Deterministic map, immutable commands, stable turn order and faction fog. No network, UI or wall-clock decisions. |
| `src/network` | Versioned redacted player view, HTTP client, reconnect and idempotent retry. No authoritative simulation in online mode. |
| `server` | Session authentication, invitations, room admission, command validation, persistence and player-specific projection. |
| `src/rendering`, `src/ui` | Render only received terrain/visible units, submit intents, show pending/offline/rejected states and touch controls. |
| PWA service worker | Versioned static application shell only. Never cache API responses or queue game orders. |

### Why HTTP polling rather than peer-to-peer or lockstep

Players can suspend their phone or close the app between turns. Foreground clients poll every 1.5 seconds for a revisioned snapshot; commands receive the authoritative result immediately. Failed connections retry after five seconds, and foreground/online transitions refresh immediately. Resume always fetches current state. No continuously connected socket, deterministic browser lockstep, host phone or client clock is required. Polling is sufficient for a small turn-based room; SSE/WebSockets can later replace notification transport without changing authority or commands.

## Protocol v1 and turn resolution

- One private room has two stable factions: Meridian (creator) and Lantern (invitee). Both must join before orders are accepted.
- The server generates an unpredictable seed. It sends neither that seed, RNG state, hidden terrain, hidden opponent units nor the authoritative command log.
- A player view contains room/revision/status, own faction/scout, active faction/round, charted tiles, visible tile IDs, visible opponent units and affordable destinations with costs.
- Online routes traverse **currently visible terrain only**. Previously explored terrain remains visible as a dim memory but cannot be used for blind orders. This prevents hidden occupancy from leaking through path/range queries; move to the edge of sight and request another route. Local expedition rules continue to allow charted terrain.
- Client orders contain only a UUID request ID, expected room revision, and `move(to)` or `end-turn`. Identity and unit are derived from the authenticated session, never trusted from a submitted faction/unit ID.
- A transaction authenticates the session, checks room readiness, detects a duplicate request, compares revision, applies the pure rule engine, then persists state and a request receipt atomically.
- A duplicate UUID with the same payload returns the current player view without another effect. Reusing an ID with different content or submitting an outdated revision returns an explicit conflict.
- Invalid commands do not change state, revision, accepted history or RNG. Successful end-turn activates the next faction and refreshes only its movement. A round increments after Lantern hands back to Meridian.
- Both the browser and server reject malformed protocol shapes. Online controls never predict success or simulate the other player.

## Persistence and reconnect

Node 24's built-in `node:sqlite` provides a single-instance durable store with foreign keys, WAL and transactions. The database is outside `dist/` and is never served statically. Persisted envelopes include schema, generator and rules versions, initial map configuration and accepted commands. On a cold read, the server validates and replays the envelope; incompatible/corrupt state fails explicitly, never as a fresh game. A revision-keyed in-memory cache avoids replay on every poll.

Session cookies are opaque random capabilities, HttpOnly, SameSite=Strict, path-scoped to `/api`, Secure in production, and persisted for 30 days. Only hashes of session and invitation secrets are stored. Sessions are established before create/join so retries of those operations resume the same membership. A used invite cannot grant a third seat. The waiting host can explicitly replace an invitation.

Cookies restore membership on the same browser/device after reload or process restart. Clearing cookies loses that device's seat: this private-room foundation has no account recovery or cross-device identity transfer. The UI can return to the local atlas without forgetting membership; forgetting a session is a separate explicit action.

A command whose reply is lost stays in `sessionStorage` with its original request ID. Reconnection retries that same intent exactly once at a time; it does not invent a new ID. New orders are disabled until uncertainty is resolved. Offline users may use the cached local atlas, but cannot create or queue new online orders.

## Limits and safety

- Same-origin JSON API; all mutating requests require an exact allowed Origin, and POST bodies require JSON content type. No permissive CORS.
- Strict request schemas and a 4 KiB body limit. Session/room/invite values are never interpolated into SQL.
- A 240-request/minute per-address limit, bounded rate tracking and room/session/command quotas limit this reference server's resource usage. The limiter uses the socket address, not forwarded headers; behind a proxy its allowance is shared unless the topology changes. Invitations are not logged and are shared in URL fragments, removed from browser history after reading.
- Rooms expire after seven inactive days; sessions after 30 days. Cleanup runs on startup and periodically. At most 128 rooms, 2,048 sessions and 5,000 accepted commands per room are supported by this preview.
- API responses are `no-store`; the service worker excludes all API requests. The browser never persists a full authoritative world.
- Cookies/capabilities are not a substitute for production account recovery, abuse controls, backups or operational monitoring. HTTPS and a durable database volume are mandatory outside loopback development.
- Single server process / SQLite volume is the supported topology. Horizontal scale requires a transactional shared database and distributed admission/rate limiting, not a second unrelated SQLite copy. Do not mount the SQLite file on an unsuitable shared network filesystem.
- There is no turn timer or forced victory. A player may return later; abandoned rooms expire. Cities, combat, victory, matchmaking and chat remain outside this architecture increment.

## Android and iOS

The manifest provides standalone display, app name, theme and 192/512 PNG icons; the Apple touch icon and safe-area layout support iOS installation. After a successful online load, the versioned static shell is cached. Android users can install through Chrome; iOS users use Safari's **Share > Add to Home Screen**. HTTPS is required except on localhost/loopback.

Portrait layout keeps a map above scrollable controls, with at least 44 px touch targets. One-finger drag pans, tap selects, two-finger pinch zooms, and explicit zoom/directional buttons remain available. Background/foreground and online/offline transitions trigger authoritative refresh rather than local turn advancement.

Automated Chromium touch and WebKit checks are engineering evidence, not certification on physical Android/iPhone devices. Actual installation, GPU behavior, background eviction, keyboard/assistive technology and battery/network behavior must still be checked on release devices.

## Running and operating

1. Use Node 24, `npm ci`, then `npm run build`.
2. `npm start` serves both the app and API on `http://127.0.0.1:4173`, storing matches under `.polaris/`.
3. Development: `npm run server` plus `npm run dev` in separate terminals; Vite proxies `/api` to the local API.
4. Production: set `NODE_ENV=production`, `PUBLIC_ORIGIN=https://your-host`, `HOST=0.0.0.0`, `PORT` and `POLARIS_DB` to a persistent local-volume file. Terminate TLS at a trusted reverse proxy and expose only that proxy. There is deliberately no wildcard-origin or forwarded-header trust.
5. Back up the SQLite database consistently using SQLite's backup facilities, including WAL state; do not copy only the main file during writes. Restore with the same supported schema/rules/generator versions. Test restore before public operation.

Server/API tests cover persistence, replay, restart, duplicate/stale/concurrent commands, authorization, fog redaction, invalid inputs, session/invite handling and static-file boundaries. Browser tests use independent clients and mobile viewports to verify the full turn handoff and reconnect path. No dependency or platform-validation gap should be represented as a successful test.

Sources: [Node 24 SQLite](https://nodejs.org/docs/latest-v24.x/api/sqlite.html), [PWA installation requirements](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).
