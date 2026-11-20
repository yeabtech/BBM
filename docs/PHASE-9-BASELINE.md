# BBM Phase 9 baseline

Captured on 2026-10-31 before Phase 9 implementation changes.

## Build and bundle baseline

Environment reported by the local tools: Node.js `v22.19.0`, npm `10.9.3`, Windows PowerShell. No CPU, memory, storage, or client hardware benchmark was collected, so this baseline makes no runtime throughput or memory claim.

`npm.cmd run build` passed for all workspaces. Vite reported a client bundling time of 8.03 seconds and emitted:

| Output                       | Minified bytes (reported) | Gzip bytes (reported) |
| ---------------------------- | ------------------------: | --------------------: |
| HTML entry                   |                   1.27 kB |               0.54 kB |
| CSS                          |                   5.96 kB |               2.14 kB |
| JS entry                     |                   2.57 kB |               1.24 kB |
| Single-player bootstrap      |                   4.81 kB |               2.04 kB |
| Multiplayer bootstrap/scenes |                  26.43 kB |               8.32 kB |
| Lobby module                 |                  27.38 kB |               8.90 kB |
| Shared Phaser-heavy chunk    |               1,217.88 kB |             335.43 kB |

The build warns that a chunk is over 500 kB. The client package depends directly on Phaser 3.90.0 and the two game bootstrap modules import Phaser. Vite emits Phaser inside the large shared JavaScript chunk. Source already dynamically imports the lobby and game bootstraps, but there is no Vite config or explicit manual chunk policy; the large shared dependency remains part of the emitted graph. `npm ls phaser --all` found one installed Phaser copy and no duplicate Phaser version. `npm ls --workspaces --depth=0` showed only declared workspace dependencies; no dependency was removed based on guesswork.

The generated HTML statically references only the 2.57 kB JS entry. That entry dynamically imports the lobby at `/`, and `/play` dynamically imports the single-player bootstrap with its Phaser dependency. The lobby dynamically imports multiplayer Phaser code only on race entry. The 1,217.88 kB emitted chunk is a shared lazy dependency in the game import graph, not an eagerly loaded initial lobby asset. The large chunk-size warning therefore overstates the lobby startup transfer cost, although the game route still pays the Phaser download cost. The client has no raster assets in its production output; its HTML, CSS, and JavaScript chunks are the emitted files. No Vite bundle analyzer plugin is installed. The build size identifies Phaser as the dominant package but does not attribute exact per-module minified byte counts.

## Baseline lifecycle and reliability findings

- Lobby and single-player/gameplay bootstraps are dynamically imported from `apps/client/src/main.ts`. The lobby's multiplayer game is also dynamically imported on entry. Leaving a game destroys its Phaser game instance, and the scene detaches its listeners and input controls on shutdown.
- `RoomSocket.connect()` waits for `open` or `error` without a timeout. Requests have a 10-second timeout. Lobby reconnect uses exponential delay capped at 10 seconds, but retries indefinitely. The lobby's connection generation suppresses stale reconnect status callbacks.
- The server WebSocket accepts at most 8,192 bytes, validates protocol version and message schemas, rejects binary payloads, serializes messages per peer, and checks authenticated identity/host membership before protected operations. IP-keyed message and command limits are held in a process-local bounded map (10,000 keys maximum).
- PostgreSQL uses one shared pool adapter from composition, with max 5 connections and a 2-second connection timeout. Repository transactions release clients in `finally`; the race results table uses a unique race key and `ON CONFLICT DO NOTHING`.
- Room expiration and host disconnect grace use a shared periodic gateway sweep. A shared race timer runs only for active races and is cancelled when idle. Runtime gameplay state is removed on results/cancellation paths and during shutdown.
- SIGINT/SIGTERM shutdown already cancels race work and closes WebSockets and the DB pool, but current `index.ts` calls `gateway.close()` before `server.close()`, so HTTP stops accepting only after gateway teardown. This ordering will be reviewed.
- Guest sessions use cryptographically generated tokens and store a SHA-256 hash. The repository root `.env.example` uses placeholders; the actual `.env` was not copied into this report or exposed. Production config requires a database URL, HTTPS origins, and trusted-proxy mode.
- Existing integration tests use PostgreSQL and cover lobby/race lifecycle, reconnect, and idempotent results. The Phase 8 suite had 87 passing tests. No sustained load test or CPU/memory profile is recorded in prior reports.

## Baseline commands

```text
node --version                         # v22.19.0
npm.cmd --version                      # 10.9.3
npm.cmd run build                      # PASS; Vite 8.03s, outputs above
npm.cmd ls --workspaces --depth=0      # one installed copy per workspace dependency
npm.cmd ls phaser --all                # Phaser 3.90.0, one copy
```

This file is the pre-change baseline required by Phase 9. Performance measurements beyond the production bundle and local Vite build time remain unmeasured until a controlled test is run.
