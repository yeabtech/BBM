# BBM Phase 5 completion report

## 1. Summary

Added the first authoritative multiplayer gameplay session to BBM. Players who start a Phase 4 race now use one server-owned simulation with shared world geometry, fixed-step movement, platform and hazard collisions, input sequencing, and authoritative snapshots. The browser predicts its own movement and reconciles it with server state; remote players render from a bounded interpolation buffer. Active players can disconnect and reconnect without losing their simulated position or jump state.

This phase adds movement only. It does not add player-to-player collisions, finish detection, results, or Phase 6 features. The original Phase 2 `/play` single-player game remains on its existing Phaser Arcade implementation.

## 2. Actual changed-file tree

```text
apps/
├── client/
│   ├── package.json
│   ├── src/
│   │   ├── game/
│   │   │   ├── input/{game-input.ts,input-state.ts}
│   │   │   ├── network/prediction.ts
│   │   │   ├── scenes/multiplayer-scene.ts
│   │   │   └── create-multiplayer-game.ts
│   │   ├── lobby/{mount-lobby.ts,room-socket.ts}
│   │   └── main.ts
│   └── tests/prediction.test.ts
└── server/
    ├── src/
    │   ├── application/services/gameplay-service.ts
    │   ├── composition/create-server.ts
    │   └── presentation/websocket/room-websocket-gateway.ts
    ├── tests/
    │   ├── integration/races.test.ts
    │   └── unit/gameplay.test.ts
    └── package.json
packages/
├── game-simulation/{package.json,tsconfig.json,src/index.ts,tests/simulation.test.ts}
└── shared-contracts/src/index.ts
docs/{ARCHITECTURE.md,PHASE-5-REPORT.md}
package.json
package-lock.json
```

Existing Phase 2 movement/configuration/level modules now re-export the shared model where applicable. There were no file deletions and no database migration.

## 3. Server physics architecture

`@bbm/game-simulation` is a pure TypeScript package with no Phaser or browser dependency. The server owns official player position, velocity, grounded and jump state, input acceptance, collisions, world limits, hazard reset, tick, and connection status. The server advances that model only from authenticated input intentions and server-side time. It does not trust a client position, velocity, collision, or physics setting.

The multiplayer Phaser scene is presentation only: it renders the shared geometry and authoritative remote players, while predicting the local player with the same pure simulation. It does not create Arcade bodies or apply an additional gravity/integration pass. Phase 2 single-player continues using its existing Arcade scene separately.

## 4. Shared movement model and configuration

The shared model reuses Phase 2's movement formulas and values: 270 px/s maximum horizontal speed, 1500 px/s² ground acceleration, 1850 px/s² ground deceleration, 900 px/s² air acceleration, 0.72 air-control multiplier, 1050 px/s² gravity, 510 px/s ground jump, 470 px/s double jump, two jumps, 2400×900 px world, and fall reset at y=700 px. Simulation delta is in seconds; world coordinates and velocities use pixels and pixels per second.

The server selects one of three distinct, configured spawn slots by room membership order (x=160, 220, 280 on the valid starting platform). Clients cannot request a slot. A shared physics revision identifies the model/configuration in snapshots.

## 5. Fixed-timestep simulation design

Each active race has one in-memory simulation runtime. It advances at 60 Hz using a 1/60-second fixed step; catch-up is capped at eight steps, excess accumulated time is dropped, and snapshots are emitted around 20 Hz. Time comes from an injected server monotonic clock, not client timestamps. A shared scheduler drives active races; it is not one timer per player. The scheduler is stopped when no sessions remain and during shutdown. Race cancellation/timeout and server shutdown remove the corresponding simulation state.

Inputs are applied in simulation order. Each race has independent state. The runtime uses bounded input queues and has no per-tick PostgreSQL writes. Scheduler and monotonic-clock ports allow deterministic tests without waiting for real countdown or simulation durations.

## 6. Collision and level geometry design

The shared package exports the Phase 2 world and platform/hazard geometry, including the starting and main platforms, raised platforms, gaps, hazard, and visual-only finish marker. A deterministic pure AABB implementation resolves vertical and horizontal platform contact, world left/right/top limits, grounded state, and hazard/fall reset. The bottom remains open so the established development reset applies. Gravity is integrated once, and side contact does not replenish a jump. The finish marker is rendered but has no race-completion behavior. Players do not collide with or push one another.

## 7. Movement input protocol

Protocol v1 adds `move_input` with only race ID, bounded monotonically increasing sequence, horizontal direction (-1, 0, or 1), and jump-held boolean. Jump presses are derived as fresh edges by the server; holding the control does not retrigger jumps. Duplicate/stale sequence numbers are ignored and implausible sequence gaps rejected. A per-player sliding input limit, 64-entry queue, 120 inputs/second limit, and 250 ms input freshness/neutralization policy bound abuse and stale movement. The existing WebSocket message-size limit remains in force.

The WebSocket gateway verifies an authenticated guest and active race membership before dispatching input. Inputs do not carry player IDs as authority and cannot contain state or settings. Existing non-gameplay WebSocket commands retain their existing rate limit.

## 8. Snapshot format and broadcast behavior

`gameplay_snapshot` contains protocol version, room and race IDs, monotonically increasing snapshot sequence, simulation tick, server timestamp, world size and physics revision, player states, and development diagnostics. Player state includes stable guest identity, lobby name/color, position and velocity, grounded/jump state, last acknowledged sequence, and connection status. No bearer token or token hash is included.

Snapshots go only to authenticated sockets attached to the matching room/race. A peer with more than 64 KiB of buffered outgoing data has a superseded gameplay snapshot dropped; it cannot stall the simulation or other peers. Snapshot queues are not persisted to PostgreSQL. Existing Phase 4 lifecycle records remain authoritative and unchanged.

## 9. Client prediction and reconciliation

The client assigns increasing input sequences, stores at most 120 pending input steps, predicts movement immediately with the shared model, and sends intentions. On an authoritative snapshot, it ignores stale snapshot sequences, removes acknowledged inputs, resets to the authoritative local state, and replays unacknowledged inputs in order. Small correction offsets are smoothed visually; a large correction snaps to the server state. Reconnect replaces the local baseline with the latest server snapshot. Prediction remains visual and never changes server state.

## 10. Remote-player interpolation

Remote states use a bounded buffer of eight snapshots and render approximately 100 ms behind server time. The buffer ignores duplicate/out-of-order snapshots, interpolates between samples, and caps extrapolation at 100 ms when an update is missing. A new/reconnected state or major correction resets the buffer rather than extrapolating indefinitely.

## 11. Disconnect/reconnect behavior

A disconnected player remains in the race state and is marked disconnected; horizontal input becomes neutral after 250 ms. Other players continue. Reconnecting with the same authenticated token restores the existing guest state without changing position, jump count, or race identity. The gateway protects a replacement socket from stale close events. A reconnect during Countdown marks the player connected before the race starts; an active-race reconnect receives the current snapshot. Phase 4 timeout/cancellation remains authoritative, and cleanup removes expired simulation state. A player who never returns remains represented as disconnected until the race terminates; no host migration was added.

## 12. Security and anti-cheat limitations

Authentication uses existing guest bearer tokens, but tokens themselves are never included in gameplay state. Membership, race IDs, input shape, sequence, direction, jump type, input rate, and message size are checked server-side. Queue and snapshot backpressure are bounded. Server-derived movement prevents direct teleport/fly/jump-count submissions. Logs do not include tokens.

This is not advanced anti-cheat: a client can still automate valid inputs within the allowed rate or exploit bugs in the shared rules. There is no behavioral detection, cryptographic client attestation, or protection from a compromised server. The server remains the authority for resulting movement.

## 13. Performance diagnostics

Development snapshots expose measured simulation tick rate, nominal snapshot rate, connected player count, active simulation count, input queue size, dropped/rejected input counts, dropped simulation ticks, and snapshot sequence. The client displays server tick/snapshot information, estimated network delay where available, prediction correction, and queue/drop diagnostics. No sensitive credentials are exposed, and routine gameplay does not add verbose server logging.

## 14. Files created, modified, or deleted

Created the shared simulation package, gameplay application service, multiplayer scene and game bootstrap, prediction/interpolation module, server gameplay tests, client prediction tests, and this report. Modified the root workspace/scripts and lockfile, client/server workspace dependencies, shared protocol contracts, existing input adapters, lobby/socket integration, server composition/WebSocket gateway, and architecture documentation. No files were deleted. No migration was needed because per-tick gameplay state is intentionally transient; no database reset or migration was run.

## 15. Exact commands executed and results

| Command                                                | Result | Details                                                                                                                                              |
| ------------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm.cmd test`                                         | PASS   | 64 tests: simulation 6, shared contracts 1, server unit 34, PostgreSQL/WebSocket integration 7, client 16; no skips.                                 |
| `npm.cmd run test:integration --workspace @bbm/server` | PASS   | 7 integration tests passed against PostgreSQL and real WebSocket clients.                                                                            |
| `npm.cmd run typecheck`                                | PASS   | Shared simulation, contracts, server, and client strict TypeScript checks.                                                                           |
| `npm.cmd run lint`                                     | PASS   | ESLint completed without findings.                                                                                                                   |
| `npm.cmd run format:check`                             | PASS   | Prettier check passed.                                                                                                                               |
| `npm.cmd run architecture:check`                       | PASS   | Existing documented server boundary scan passed.                                                                                                     |
| `npm.cmd run build`                                    | PASS   | Shared packages, server, and client production builds completed. Vite reports its existing Phaser bundle size advisory (about 1.22 MB uncompressed). |

The first run of an expanded countdown-disconnect test timed out; that test-only extension was reverted after identifying that the scenario introduced an unrelated harness wait. The production reconnect behavior remains covered by service tests and the existing active-race WebSocket reconnect integration case. The final full suite and standalone integration suite both passed. Full tests and integration needed process access because the restricted Windows Node runner can fail while querying user information and connecting to local PostgreSQL.

## 16. Automated test coverage

Pure model tests cover acceleration, braking, reversal, speed cap, air control, gravity, ground/double/held jump, landing reset, side collision, gaps, world bounds, hazard reset, and fixed-step behavior. Service tests cover spawn order, independent sessions, sequence validation, bounded catch-up, stale-input neutralization, disconnect/reconnect state, queue/rate bounds, jump edges, and cleanup. Protocol tests cover exact movement-intention shape and authoritative snapshot validation. Client tests cover prediction, reconciliation, acknowledgement/replay, stale snapshots, interpolation ordering, bounded extrapolation, and buffer clearing. PostgreSQL/WebSocket tests exercise authenticated room participants, shared race ID and snapshots, server movement, rejection of forged positions, active reconnect, race timeout/cancellation, and existing lobby/lifecycle behavior.

## 17. Manual browser verification

**NOT RUN.** Two independent browser sessions were not available for this run. Automated WebSocket integration verifies server state and transport behavior, but does not prove Phaser scene appearance, perceived interpolation, keyboard/touch feel, or a human end-to-end play-through. Follow the two-client desktop/mobile checklist in the Phase 5 request before claiming visual gameplay verification.

## 18. Known issues and limitations

- Browser multiplayer gameplay and mobile hardware controls remain unverified.
- Phaser remains a large production dependency; Vite emits the standard chunk-size advisory.
- Client prediction and remote interpolation are covered by unit tests, not a browser rendering harness; perceived latency/correction tuning may need adjustment after play-testing.
- Input rate limiting is process-local, consistent with the existing server setup; it does not coordinate across multiple server instances.
- Anti-cheat is limited to server authority and bounded validated intentions; it is not a complete cheat-detection system.

## 19. Confirmation that Phases 1–4 remain intact

Phase 1 health/configuration/database foundation, Phase 2 single-player `/play`, Phase 3 guest and lobby behavior, and Phase 4 authoritative countdown/race lifecycle remain in place. The original single-player scene remains separate. Existing PostgreSQL migrations were not modified, and no data was reset. Automated regression tests passed.

## 20. Explicit Phase 6 boundary

No power-ups, pickups, player collisions or pushing, checkpoints, advanced respawn, finish detection, placements, winner/loser decision, results screen, leaderboard, bots, matchmaking, host migration, chat, payments, or other Phase 6 feature was implemented. Phase 5 is complete; review this report and browser behavior before authorizing Phase 6.
