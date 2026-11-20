# BBM Phase 9 completion report

## 1. Executive summary

Improved connection and shutdown reliability, hardened production configuration, made compiled migrations deployable, added bounded race/snapshot load tooling, and documented production operation. No gameplay rule, protocol field, simulation tick rate, snapshot frequency, database migration, or deployment target was changed.

The production build still emits a 1,217.88 kB (335.43 kB gzip) shared Phaser chunk and Vite's over-500 kB warning remains. Inspection of generated HTML and dynamic import edges established that this chunk is loaded with `/play` or a multiplayer game entry, not on the root lobby's initial load. The lobby was already lazy-loaded before Phase 9; an explicit chunk rule would have added a redundant split without reducing the measured first-load path, so no Vite split was added.

## 2. Initial performance baseline

The pre-change measurements and lifecycle review are recorded in [PHASE-9-BASELINE.md](PHASE-9-BASELINE.md). Baseline environment: Node `v22.19.0`, npm `10.9.3`, Windows. The baseline production Vite build took 8.03 seconds. No CPU or memory benchmark was available at baseline.

Baseline output included a 2.57 kB HTML JS entry and a 1,217.88 kB shared Phaser-heavy chunk. Generated `index.html` referenced only the small entry. The entry dynamically imported the lobby or game bootstrap, and source dynamically imported multiplayer only on race entry. Thus the large warning described the deferred game bundle rather than lobby startup bytes.

## 3. Final performance measurements

Final Vite build reported 8.10 seconds. These are build-time artifact sizes, not runtime CPU/RAM or real-user timings.

| Output                       | Baseline kB (gzip) |   Final kB (gzip) |   Change |
| ---------------------------- | -----------------: | ----------------: | -------: |
| HTML                         |        1.27 (0.54) |       1.27 (0.54) |        0 |
| CSS                          |        5.96 (2.14) |       5.96 (2.14) |        0 |
| Initial JS entry             |        2.57 (1.24) |       2.57 (1.24) |        0 |
| Single-player bootstrap      |        4.81 (2.04) |       4.81 (2.04) |        0 |
| Multiplayer bootstrap/scenes |       26.43 (8.32) |      26.53 (8.33) | +0.10 kB |
| Lobby module                 |       27.38 (8.90) |      29.32 (9.38) | +1.94 kB |
| Shared Phaser-heavy chunk    |  1,217.88 (335.43) | 1,217.88 (335.43) |        0 |

The additional lobby bytes implement connection timeout and bounded retry handling. The root lobby route still does not load Phaser. The Vite warning remains because Phaser itself exceeds 500 kB minified; the game route's framework payload was not reduced. The baseline/final total emitted JavaScript increased by 2.04 kB minified (0.49 kB gzip) from the added client reliability behavior.

No raster or binary game assets were found in the JavaScript output. `npm ls phaser --all` found one installed Phaser 3.90.0 copy. No dependency was removed without evidence of being unused.

## 4. Client optimization and runtime review

The existing route-level dynamic imports were preserved. The build graph was inspected to verify that the HTML entry references the small entry module and that game bootstraps reference the Phaser-heavy chunk dynamically. No blind manual chunk split was added. Phaser scene creation remains on entry to `/play` or an active race; scene shutdown detaches message, connection, resize, and input listeners. Multiplayer particles destroy themselves, scene tweens belong to Phaser's scene lifecycle, and the additional countdown resize listener now has explicit shutdown cleanup.

No repeated texture or asset initialization change was needed. There is no React layer. The lobby updates the DOM on received room/state events, not per simulation tick. Existing prediction and bounded interpolation buffers remain unchanged.

## 5. Network and WebSocket reliability

- Browser connection opening now times out after 8 seconds; guest authentication times out after 10 seconds. Pending requests are rejected and timers cleared on connection close.
- Old socket message, error, and close callbacks are ignored after replacement. Intentional close cancels pending connection attempts without emitting a spurious transport error. Synchronous send races return a safe failure instead of escaping from input updates.
- Lobby reconnect retains exponential delays capped at 10 seconds, stops after 8 automatic attempts, and leaves the existing manual reconnect action available. A successful authenticated event resets the attempt count; invalid stored tokens stop automatic retries.
- Existing server validation remains: versioned runtime message parsing, text-only frames, 8 KiB maximum WebSocket payload, bounded inbound queue, invalid-message close behavior, authentication before commands, authenticated guest/room membership checks, host-only race start, origin checks, and per-IP limits.
- Snapshot sequence rejection, input acknowledgement/replay, interpolation buffer bounds, server authority, and 20 Hz snapshot emission are unchanged. No movement data is trusted from client messages.

## 6. Server resource management

Room and race sweep callbacks now guard against overlapping work. They continue to use the existing shared scheduler and are skipped once shutdown begins. Existing lifecycle behavior closes expired/empty rooms from active use, cancels related races, clears stale peer references, removes completed/cancelled gameplay simulation state, and stops idle race timers. Closed room/race records remain persisted as history; no retention deletion was introduced.

SIGINT/SIGTERM handling now stops accepting HTTP connections first, drains the WebSocket gateway and its scheduler work next, and closes the shared PostgreSQL pool afterward. Shutdown failures are logged with an error name only and produce a nonzero process exit status. The existing `ServerRestart` cancellation behavior remains.

## 7. Database review

Composition creates one shared PostgreSQL pool with max 5 connections and a 2-second connection timeout. Repository transactions release checked-out clients in `finally`. Pool errors from idle clients are now caught and logged using error name/code only; no connection URL or credential is logged. Race results are protected by a primary key on race ID and `ON CONFLICT DO NOTHING`; an integration test now races five simultaneous result writes and verifies one consistent result.

Existing partial indexes cover open-room expiry/host grace, active guest membership, due countdowns/timeouts, and one active race per room. Result lookup is by the `race_results` primary key. No additional index was justified. Existing migration files were not edited. Server builds now copy the four SQL migrations into `dist`, and production migration commands use compiled Node output rather than the development-only `tsx` runner.

## 8. Security review

- Guest tokens continue to use 32 cryptographically random bytes and persist only SHA-256 hashes. Authentication derives identity from the token; client-submitted guest IDs do not authenticate requests. The token is still retained in browser local storage, so same-origin script execution remains a session risk; the application has no analytics or third-party script dependency, but local storage is not an HttpOnly cookie.
- Production startup now requires `DATABASE_REQUIRED=true` as well as a database URL, HTTPS client origins, and trusted-proxy mode. Configured client origins must be exact URL origins without paths. `.env.example` uses a loopback host and safe local placeholders; it contains no credentials.
- HTTP and WebSocket origin checks, request limits, authenticated membership checks, host authorization, and message rates remain active. Malformed and oversized WebSocket frame tests verify rejection while the health endpoint remains available.
- Logs include safe error names/codes and guest IDs where operationally useful; token values and `DATABASE_URL` are redacted. The actual `.env` was not included in this report or modified.
- Rate limits are in-memory with a 10,000-key bound and process-local state. WebSocket IP attribution uses the socket's remote address; behind a reverse proxy, clients may share the proxy address. These limits do not protect multiple instances and no distributed limiter is claimed.
- `TRUST_PROXY=true` assumes the API is reachable only through a trusted proxy that overwrites forwarded headers. Production network policy must prevent direct untrusted access to the API listener.

## 9. Load-test methodology and results

Added `scripts/load-test.mjs` and `npm.cmd run load:test`. It only accepts a loopback HTTP target, bounds each run to at most five room starts, supports two or three synthetic players, reconnects one non-host during the countdown, waits for timeout result persistence, and reports WebSocket message/byte counts, snapshot JSON parse time, request RTT percentiles, protocol errors, and database health before/after. It can create missing synthetic guest records within the existing per-IP rate limit or accept pre-created tokens through an environment variable. It never prints tokens.

**NOT RUN.** The configured database is shared and server startup intentionally closes open rooms and cancels active races. No isolated disposable database was available, so I did not start a separate server or create load-test records. Consequently this report contains no sustained-load CPU, server memory, client memory, database failure rate, or throughput measurements, and claims no tested player-capacity target. The reproducible isolated-database procedure and external Windows CPU/working-set capture steps are in [DEPLOYMENT.md](DEPLOYMENT.md).

## 10. Production configuration

Added [DEPLOYMENT.md](DEPLOYMENT.md) with local development, production build/start, migration, reverse-proxy/WebSocket, health checks, troubleshooting, backup/restore considerations, and bounded local load procedure. Production uses a separate static client artifact and API server; no hosting provider or paid service was selected. `.env.example` now lists `NODE_ENV` and the public build-time `VITE_API_BASE_URL` placeholder. Client `VITE_` values are public and contain no secrets.

Server workspace build copies SQL files to its compiled migration directory. Root `migrate` and `migration:status` commands build the shared packages and server before invoking compiled migration code. `npm.cmd run start:server` starts the compiled API. The API does not serve the static client; production must serve `apps/client/dist` on HTTPS and proxy `/ws` with WebSocket upgrade support.

## 11. Environment variables

Names and safe example values are documented in `.env.example` and [DEPLOYMENT.md](DEPLOYMENT.md): `NODE_ENV`, `HOST`, `PORT`, `LOG_LEVEL`, `DATABASE_URL`, `DATABASE_REQUIRED`, `CLIENT_ORIGINS`, `TRUST_PROXY`, `ROOM_IDLE_MINUTES`, `HOST_GRACE_SECONDS`, `ROOM_SWEEP_SECONDS`, `RACE_COUNTDOWN_SECONDS`, `RACE_TIMEOUT_SECONDS`, `RACE_TICK_MS`, and build-time `VITE_API_BASE_URL`. Load-test-only controls are `BBM_LOAD_TEST_URL`, `BBM_LOAD_TEST_ROOMS`, `BBM_LOAD_TEST_PLAYERS`, `BBM_LOAD_TEST_CYCLES`, `BBM_LOAD_TEST_RESULT_TIMEOUT_MS`, and optional `BBM_LOAD_TEST_TOKENS`.

## 12. Database migration changes

None. No migration was added, edited, or run. `npm.cmd run migration:status` reported migrations 001–004 applied. No database reset or data deletion was performed.

## 13. Changed-file tree

```text
.env.example
README.md
package.json
apps/client/src/lobby/mount-lobby.ts
apps/client/src/networking/room-socket.ts
apps/client/src/networking/reconnect-policy.ts
apps/client/tests/reconnect-policy.test.ts
apps/server/package.json
apps/server/scripts/copy-migrations.mjs
apps/server/src/index.ts
apps/server/src/infrastructure/configuration/config.ts
apps/server/src/infrastructure/persistence/postgres/postgres-health-repository.ts
apps/server/src/infrastructure/runtime/graceful-shutdown.ts
apps/server/src/presentation/websocket/room-websocket-gateway.ts
apps/server/tests/integration/races.test.ts
apps/server/tests/unit/config.test.ts
apps/server/tests/unit/gameplay-service.test.ts
apps/server/tests/unit/graceful-shutdown.test.ts
docs/DEPLOYMENT.md
docs/PHASE-9-BASELINE.md
docs/PHASE-9-REPORT.md
scripts/load-test.mjs
```

## 14. Automated test results

- `npm.cmd test`: PASS, 93 tests total: 18 simulation, 1 shared contracts, 43 server unit, 9 server integration, 22 client.
- New coverage includes 100 sequential race runtime cleanups, five concurrent idempotent result writes, graceful shutdown ordering, production configuration validation, malformed/oversized WebSocket rejection, reconnect backoff bounds, and a post-rejection API health check.
- `npm.cmd run typecheck`: PASS.
- `npm.cmd run lint`: PASS.
- `npm.cmd run format:check`: PASS.
- `npm.cmd run architecture:check`: PASS.
- `npm.cmd run build`: PASS; Vite's existing Phaser >500 kB advisory remains.
- `npm.cmd run migration:status`: PASS; migrations 001–004 applied.
- `node --check scripts/load-test.mjs`: PASS. The load procedure itself was not run.

## 15. Exact commands executed

```text
node --version
npm.cmd --version
npm.cmd ls --workspaces --depth=0
npm.cmd ls phaser --all
npm.cmd run build
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run format:check
npm.cmd run architecture:check
npm.cmd run migration:status
node --check scripts/load-test.mjs
npx.cmd prettier --write README.md package.json apps/server/package.json apps/client/src/lobby/mount-lobby.ts apps/client/src/networking/room-socket.ts apps/client/src/networking/reconnect-policy.ts apps/client/tests/reconnect-policy.test.ts apps/server/src/index.ts apps/server/src/infrastructure/configuration/config.ts apps/server/src/infrastructure/persistence/postgres/postgres-health-repository.ts apps/server/src/infrastructure/runtime/graceful-shutdown.ts apps/server/tests/integration/races.test.ts apps/server/tests/unit/config.test.ts apps/server/tests/unit/gameplay-service.test.ts apps/server/tests/unit/graceful-shutdown.test.ts apps/server/scripts/copy-migrations.mjs scripts/load-test.mjs docs/DEPLOYMENT.md docs/PHASE-9-BASELINE.md docs/PHASE-9-REPORT.md
```

The Vite baseline/final build and full test suite passed. The first build attempt while a temporary Vite config existed failed in the restricted Windows sandbox trying to inspect a parent directory; that config was removed after bundle-graph inspection showed explicit splitting was unnecessary. The final default Vite build passed in the sandbox. Tests ran with approved normal process access due Node's Windows user-information lookup limitation.

## 16. Manual browser test results

**NOT RUN.** No interactive browser or multi-session browser automation was available. Single-player and multiplayer visual flows, repeat lobby transitions, mobile play, and production static/API startup were not manually verified. Automated integration tests cover protocol, reconnect, race persistence, and lifecycle paths only.

## 17. Known limitations

- Phaser remains a 1,217.88 kB minified / 335.43 kB gzip deferred game dependency; the Vite warning remains. Baseline graph inspection shows it is already deferred from the root lobby. Reducing Phaser itself would require a different build of Phaser or functionality tradeoffs, neither justified here.
- No controlled load run or CPU/RAM capacity measurement was performed; use the isolated procedure before setting production capacity targets.
- Local-storage bearer tokens remain vulnerable to same-origin script execution.
- Process-local rate limits do not coordinate across instances, and reverse-proxy clients may share one socket IP bucket.
- Closed room/race rows are retained as history; this phase adds no data-retention deletion policy.
- No production provider, TLS terminator, CDN, backup scheduler, or deployment automation was selected or exercised.

## 18. Phases 1–8 remain intact

Clean Architecture, private rooms, server-authoritative movement, race timing, collision and power-up rules, level/hazards, result semantics, and presentation remain in their existing authority boundaries. Existing movement constants, message contracts, and snapshot frequency were not changed. All existing tests remain enabled and pass.

## 19. Phase 10 boundary

Phase 10 was not started.
