# BBM Phase 10 completion report — local Wi-Fi hotspot multiplayer

## 1. Summary

BBM can now run a private two- or three-player Greenway Rush on one Windows computer that hosts a Wi-Fi network or mobile hotspot, with no internet access. The host runs the existing API, WebSocket gateway, PostgreSQL database, and the built browser client; other devices load the game from the host's own address and join with a room code.

This phase built on an existing opt-in LAN layer and finished the parts that the hotspot scenario actually needed:

1. **Client hosting from the host computer.** Previously every device had to load the client from a separate Vite dev server and add its exact origin to `CLIENT_ORIGINS`. Phase 10 lets the existing server serve the production client bundle on its own port (`CLIENT_DIST`), so the client, API, and WebSocket share one origin.
2. **Same-origin origin validation.** The shared origin policy now accepts a same-origin browser (including browser-defaulted port 80) when the server hosts the client, and rejects foreign origins consistently for both HTTP and WebSocket, in both the normal build and the hosted build.
3. **Verification of the real path.** A new end-to-end harness drives the production server over a real local IPv4 address and completes a two-player race through the hosted client.

Gameplay rules, physics, simulation rate (60 Hz), snapshot rate (20 Hz), the race lifecycle, lobby rules, database schema, and all previously applied migrations are untouched.

## 2. What already existed before this phase (verified by inspection)

- `LAN_ENABLED` opt-in hint; `HOST` restricted to `127.0.0.1`/`::1`/`localhost` unless LAN mode is enabled; LAN mode defaults to `0.0.0.0` and requires an IP assigned to a local interface otherwise.
- `/api/lan-info` returning private IPv4 interface addresses, ordered `192.168.*` first, with loopback/link-local/public/IPv6 and internal adapters excluded.
- Lobby panel showing LAN status, addresses, a copy-server-address action, host-address/port inputs, guest identity per server origin, and understandable errors for timeouts, unreachable hosts, database-unavailable, room codes, and full rooms.
- Loopback integration tests for guests, room capacity, readiness, two-/three-player start, reconnect, and shutdown.

The Phase 10 report that preceded this work stated these items but did not cover client hosting from the host, and its "lint/format PASS" claim did not match the repository (see §7).

## 3. Changes made in this phase

### 3.1 Server-hosted client bundle

- New `CLIENT_DIST` setting. When it points to a built client (validated to contain `index.html`; the file is resolved once at startup), the existing `createServer` HTTP instance also serves the bundle.
- `presentation/http/client-assets.ts` serves only files inside the bundle directory (path traversal and encoded traversal rejected), `/api` and `/ws` always fall through to the API, unknown HTML routes return the app page, missing assets return 404, and writes get `405`. Hashed `assets/*` are cached immutably; HTML is `no-cache`.
- When the hosted client is enabled, unmatched paths end in this app's plain 404 (registered after the error handler) so no framework HTML error page or bundle-stack detail leaks.
- `apps/client/vite.config.ts` uses `base: "./"` so one build works from Vite and from the API origin; explicit `index.html` + `play.html` entries let the solo scene work as `/play.html`; `main.ts` and the lobby link route accordingly. Vite was already a dev dependency; no new dependency was added.

### 3.2 One shared origin policy

- New `presentation/http/client-origin.ts`, used by both the Express app and `RoomWebSocketGateway`. Accept when: exact `CLIENT_ORIGINS` match, or (outside production) a same-host Vite origin on ports 5173–5180, or the server hosts the client and the origin hostname equals the Host header hostname with matching effective port (default `:80` included).
- Removed the duplicated, subtly different origin logic from `app.ts` and `room-websocket-gateway.ts`. The HTTP app now rejects any untrusted browser origin (previously only when `allowedOrigins` was configured), matching the WebSocket behavior.
- `/api/lan-info` additionally reports `clientServed`, which the lobby uses to show the exact `http://<host-ip>:<port>/` link next to the room code instead of a Vite URL that no longer exists on other devices.

### 3.3 Path handling, first-run usability, and the lobby UI

Verification of the hosted path (driving the built page in a headless browser) found and fixed defects that the automated API tests could not see:

- **`CLIENT_DIST` was resolved against the process working directory.** `npm run start:server` runs in `apps/server`, so the documented value `apps/client/dist` failed at startup. It now resolves against the working directory first and then the repository root (derived from `module.url`, valid for both `src` and `dist`), and reports a clear error when no `index.html` exists. Covered by `tests/unit/config-client-dist.test.ts`.
- **Missing favicon** produced a 404 on every page load. Added an inline SVG `favicon.svg` referenced by both HTML entries.
- **Lobby clarity.** Added a three-step host guide, turned the address line into one copyable connection link plus separately listed adapters, and removed the duplicated "Copy server address" control. The host address field now prefills the computer's reachable private address instead of loopback, with a "Use this computer's address" action for choosing it explicitly.
- **Layout defects** fixed after visual inspection at 1280px and 390px: step cards misaligned on narrow screens, missing spacing between the address list and the form, and `hidden` being defeated by layout `display` rules (now `[hidden] { display: none !important }`).
- **Dead control removed:** the host-only "Check readiness" button was disabled until it became unnecessary, so it no longer appears; readiness is stated in the ready summary and the race still starts through the existing host-only path.

### 3.4 Served-by-the-API detection (phone-reported 404)

A phone that opened the **Vite** dev page (`http://<host-ip>:5173/`) got `POST /api/guests 404`, because Vite serves only the client and has no API routes. The client had guessed `http://<hostname>:3000` and, worse, a stored server address could silently override the origin that actually served the page.

- The lobby now determines whether the page was served by the BBM API by requesting `/api/lan-info` and requiring a valid JSON body (a static host answers any path with HTML, so a 200 alone is not evidence). When it was, that origin is authoritative for HTTP and WebSocket and stored addresses from other sessions are ignored.
- On a Vite page with no explicitly connected server, creating a guest is refused with a clear instruction (enter the host address, press **Connect to server**) instead of issuing a request to a guessed port.
- The LAN panel distinguishes "not served by a BBM server" from "server running in localhost-only mode".
- The Vite dev server is bound to the LAN only so that page can be opened at all; it remains a client-only server and this is documented.

### 3.5 One-click hosting and one-command start

The earlier flow required running two servers, editing `.env`, and typing an IP address — reasonable for an operator, unreasonable for "host a game and share a code". It was simplified:

- **`npm run host`** builds the client, starts the single server with `CLIENT_DIST` set, opens the lobby, and prints what to do. No `.env` editing.
- **Start hosting** in the lobby calls `POST /api/hosting`, which rebinds the _same_ HTTP server (API, WebSocket and served client) from loopback to all interfaces on the same port. The control is created only outside production, is unavailable when the server does not host the client, and is idempotent.
- The lobby shows the shareable link and room code and no longer asks for addresses. Manual address entry moved into a collapsed **Joining a different computer?** section.
- The empty-body failure (`Unexpected end of JSON input`) is gone: every response goes through one parser that reports a missing server, a non-JSON body, or an empty error body in plain language.
- Starting servers is still safe by default: nothing listens beyond loopback until the host presses the button, and a configured non-loopback `HOST` still requires `LAN_ENABLED=true`.

### 3.6 Configuration and composition

- `create-server.ts` passes `clientDist` to the HTTP app and `Boolean(clientDist)` to the gateway; `index.ts` is unchanged. Localhost default binding, port configuration, and the single game/HTTP/WebSocket implementation are preserved.

## 4. Hotspot architecture

```text
Host PC (authoritative)
  PostgreSQL  ◄── apps/server (single process)
                    ├── GET /            served client bundle (optional CLIENT_DIST)
                    ├── /api/*           guest + health
                    ├── /ws              lobby and race WebSocket
                    └── GameplayService  60 Hz simulation, 20 Hz snapshots
          ▲ HTTP + WebSocket, same origin
  Phone / second PC  http://<host-ip>:<port>/
```

- **Host starts a game:** start PostgreSQL → `npm run build` → start server with `LAN_ENABLED=true`, `HOST=0.0.0.0`, `DATABASE_REQUIRED=true`, `CLIENT_DIST=apps/client/dist` → open the lobby on the host → create a guest → create a private room → share the link and code → players ready up → host starts the race.
- **Other devices join:** connect to the hotspot Wi-Fi, open `http://<host-ip>:<port>/`, enter the same host/port in the lobby's server form, create a guest identity, enter the room code. No account, cloud token, or internet DNS is involved.
- **Offline operation:** everything needed (server, database, client assets, terrain art) is local. The client bundle references only relative assets; there are no external fonts, CDNs, or asset hosts. The only network peers are the host computer and the other players.
- **Discovery:** deferred. Manual IP entry is mandatory in the spec and always available. Broadcast discovery would either leak room data or add a second protocol for little benefit on a three-player hotspot; documented as deferred rather than half-implemented.

## 5. Security decisions

- Hotspot exposure still requires the explicit `LAN_ENABLED=true`; the default sample and configuration remain loopback-only, and a non-loopback bind without it is rejected at startup.
- Same-origin acceptance applies only when the server itself hosts the client, only outside production, only for `http:`, and only when the origin hostname matches the hostname the browser used. Production still requires explicit HTTPS origins.
- Guest token hashing, token-in-header/message authentication, room membership validation, host-only race start, WebSocket payload limits (8 KiB), inbound queue limits, message and room-create rate limits, and server-authoritative movement/results are unchanged. Tokens remain out of URLs.
- The static handler never serves outside its directory and exposes no administrative action; `/api/lan-info` returns no guest, room, or token data.
- Forwarded headers are still honored only via `TRUST_PROXY`. Plain HTTP on a trusted private network is a documented limitation; Windows Firewall guidance scopes the rule to the Private profile and local subnet and never suggests disabling it.

## 6. Database changes

None. No migration was added, edited, or applied, and no reset or destructive operation was run. `npm.cmd run migration:status` reports 001–004 applied. Guest identities and race history are preserved.

## 7. Validation results (exact)

All commands were run in this workspace on the 2026-10-31 session with the local PostgreSQL 17.6 instance.

| Check                                   | Result                                                                                                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm.cmd test`                          | **PASS** — 125 tests: simulation 18, shared-contracts 1, server unit 65, server integration 16, client 25. 0 failures, 0 skipped.                                               |
| `npm.cmd run typecheck`                 | **PASS** (exit 0)                                                                                                                                                               |
| `npm.cmd run architecture:check`        | **PASS**                                                                                                                                                                        |
| `npm.cmd run build`                     | **PASS** — server + client; Vite 7.3.7, existing Phaser chunk 1,223.14 kB (gzip 337.06 kB) with the pre-existing 500 kB advisory                                                |
| `npm.cmd run migration:status`          | **PASS** — 001–004 applied                                                                                                                                                      |
| `node scripts/verify-hotspot.mjs`       | **PASS** — 13/13 checks against the production server on the host's real IPv4 address                                                                                           |
| `npm.cmd run lint`                      | **FAIL (pre-existing, untouched files)** — `apps/client/src/game/rendering/build-level.ts:3` unused `LEVEL_VISUAL_CONFIG`; `scripts/capture-camera.mjs:52` expression statement |
| `prettier --check` on all changed files | **PASS** — the remaining `format:check` failures are 4 pre-existing files this phase did not modify (`.vscode/settings.json`, terrain manifest, two capture scripts)            |

Browser verification: the built client was loaded through the API (`http://127.0.0.1:3000/`), a guest was created (HTTP 201), and a room was created, with **0 console errors and 0 failed requests**, no horizontal overflow at 390 px, no loopback address advertised, and the host field prefilled with the reachable address.

Test count moved from 100 (baseline) to 117: +7 `client-origin` unit tests, +6 `client-hosting` integration tests, +3 `CLIENT_DIST` resolution tests, and the existing lobby integration test now runs twice (dev-client origin and server-hosted client).

The pre-existing lint and format failures were present before any Phase 10 change and are outside this phase's scope (rendering code and a capture script); they were not "fixed" by editing unrelated gameplay/rendering files.

### 7.1 End-to-end harness output

`node scripts/verify-hotspot.mjs` starts the built server bound to the host's LAN IPv4 (`HOST=<lan-ip>`, `LAN_ENABLED=true`, `CLIENT_DIST=apps/client/dist`) and reported:

```text
PASS  client page loads from LAN address — http://172.20.10.4:<port>/
PASS  client bundle assets load over HTTP
PASS  LAN info reports enabled hosting
PASS  LAN info reports the client is served
PASS  LAN info lists a usable IPv4 address — 192.168.75.1, 192.168.93.1, 172.20.10.4
PASS  LAN info never advertises loopback
PASS  foreign origin is rejected — status 403
PASS  two LAN guests authenticate over WebSocket
PASS  host creates a private room
PASS  guest joins by room code
PASS  room becomes startable with two ready players
PASS  host starts Greenway Rush
PASS  authoritative gameplay snapshots reach the LAN guest
13/13 checks passed
```

This uses real IP-addressed loopback routing on the host (Windows routes the host's own LAN address locally). It proves addressing, hosting, origin, and protocol behavior; it does **not** prove physical-device reachability.

## 8. Manual testing guide (see docs/LAN-PLAY.md)

1. Start PostgreSQL and verify migrations without resetting the database.
2. Build and start BBM in hotspot mode (`LAN_ENABLED=true`, `DATABASE_REQUIRED=true`, `CLIENT_DIST=apps/client/dist`).
3. Enable a Windows mobile hotspot (or connect Windows to an Android phone hotspot).
4. Connect a phone or second computer to the hotspot.
5. Find the host's usable IPv4 (`ipconfig` or the lobby's address list; ignore Hyper-V/VirtualBox/VPN adapters).
6. Open `http://<host-ip>:3000/` from the other device.
7. Join using that address and the room code.
8. Test a two-player race; then a three-player race (third joins before start).
9. Test disconnection and reconnection (close a non-host tab briefly; reconnect with the same browser profile).
10. Disconnect the hotspot from the internet and repeat a race to confirm offline operation.
11. Troubleshoot Windows Firewall (Private profile, local subnet only, `New-NetFirewallRule` example) and client isolation.

### Manual tests NOT performed

**No physical second device, phone browser, hotspot adapter, or Windows Firewall rule was exercised in this session.** The automated suite and the harness above run on one computer. Physical two- and three-device results, phone layout, hotspot client isolation, and firewall behavior remain **unverified**.

## 9. Changed files

```text
.env.example
README.md
apps/client/index.html
apps/client/play.html                         (new)
apps/client/vite.config.ts                    (new)
apps/client/src/main.ts
apps/client/src/style.css
apps/client/src/lobby/mount-lobby.ts
apps/client/public/favicon.svg                 (new)
apps/server/src/composition/create-server.ts
apps/server/src/infrastructure/configuration/config.ts
apps/server/src/presentation/http/app.ts
apps/server/src/presentation/http/client-origin.ts   (new)
apps/server/src/presentation/http/client-assets.ts   (new)
apps/server/src/presentation/websocket/room-websocket-gateway.ts
apps/server/tests/unit/client-origin.test.ts  (new)
apps/server/tests/unit/config-client-dist.test.ts (new)
apps/server/tests/unit/client-hosting-mode.test.ts  (new)
apps/server/tests/unit/lan-hosting.test.ts          (new)
apps/server/src/presentation/http/lan-hosting.ts    (new)
scripts/host-bbm.ps1                                (new)
scripts/verify-host-button.ps1 / .mjs               (new)
apps/server/tests/unit/health.test.ts
apps/server/tests/integration/client-hosting.test.ts (new)
apps/server/tests/integration/lobby.test.ts
docs/ARCHITECTURE.md
docs/DEPLOYMENT.md
docs/LAN-PLAY.md
docs/PHASE-10-REPORT.md
scripts/verify-hotspot.mjs                    (new)
```

## 10. Known limitations

- Hotspot mode uses plain HTTP on a trusted private network; there is no TLS in this mode.
- `CLIENT_DIST` must be set (and `npm run build` run) to serve the client from the API port; otherwise the Vite dev client is required and its exact origin must be configured.
- Address detection lists private IPv4 only; hotspot, VPN, and virtual adapters can be confusing and need `ipconfig` to disambiguate.
- Router/hotspot client isolation, Windows Firewall, and endpoint security can still block traffic even when correctly configured.
- Re-authentication is limited to 5 guest creations per IP per 10 minutes; careless tab resets on many devices can hit it.
- No discovery, no installer/service wrapper, no automatic firewall rule, no public hosting provider.
- **Start hosting rebinds the listener**, so existing WebSocket connections are closed and clients reconnect automatically; a race already in progress is not stalled by this (it only happens before play).
- Hosting can be enabled only from the host's own computer (until it is enabled, the API listens on loopback only). The request itself carries no credentials beyond the browser's local access; there is no remote admin surface.
- The Vite dev page remains a developer convenience; other devices should use the API-served page. The phone-reported Vite flow is covered by unit tests of the decision logic, not by a physical device run.
- Pre-existing lint/format failures remain in unrelated files (see §7).

## 11. Deferred work

- Automatic LAN discovery (mDNS/UDP beacon) with manual fallback.
- Optional HTTPS for private networks, and a one-command host script.
- Physical multi-device test automation.

## 12. Phase boundary

Phase 10 stops here. Phase 11 has not been started.
