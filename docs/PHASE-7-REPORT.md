# BBM Phase 7 completion report

## 1. Summary

Expanded the multiplayer prototype into Greenway Rush, a continuous route with four labeled sections, elevation changes, gaps, checkpoints, power-ups, moving platforms, spikes, a triggered falling block, a moving crusher, pits, and a finish marker. The server advances environment state on the existing 60 Hz simulation clock and includes obstacle state in authoritative snapshots. The client renders those snapshots with parallax scenery, route labels, hazard markings, and progress/checkpoint/status HUD information. Phases 1–6 remain in place. No database migration or Phase 8 work was added.

## 2. Changed-file tree

```text
apps/client/src/game/level/level-visual-config.ts
apps/client/src/game/scenes/multiplayer-scene.ts
apps/server/src/application/services/gameplay-service.ts
apps/server/tests/unit/{gameplay-service.test.ts,protocol.test.ts}
packages/game-simulation/src/index.ts
packages/game-simulation/tests/simulation.test.ts
packages/shared-contracts/src/index.ts
docs/ARCHITECTURE.md
docs/PHASE-7-REPORT.md
```

## 3. Level design and route

The shared level remains 2400×900 px. Section A starts on wide ground and introduces gaps and checkpoint one. Section B uses raised platforms and two moving lift paths with a power-up opportunity. Section C combines the spike strip, a proximity-triggered falling block, moving crusher, a ground gap, and checkpoint two. Section D provides a final raised-platform/pickup route and finish area. The route uses existing movement and double-jump settings and is shared by two or three racers.

## 4. Level configuration architecture

`TEST_LEVEL` identifies `greenway-rush` / “Greenway Rush” and contains static geometry, hazards, moving-platform paths, falling-block trigger/timing settings, crusher paths, checkpoints, pickups, and finish location. `environmentAt(time)` is deterministic. Per-race falling-block activation state belongs to `GameplayService`; current obstacle state travels in `GameplaySnapshot`. Client-only palette, parallax, clouds, and route labels are in `level-visual-config.ts`.

## 5. Moving platforms

Platforms use triangle-wave paths derived from simulation time and reverse without discontinuities. The server includes them as collision surfaces. A grounded racer overlapping a moving platform is translated by its per-tick displacement before player simulation; jumping disables carry. Coordinates are broadcast in gameplay snapshots.

## 6. Falling blocks

A configured trigger radius starts the server-owned block timer. The block accelerates down during the fall interval, remains in a reset interval, then returns to idle. It is a collision surface; dangerous contact invokes the existing respawn flow. Its coordinates and lifecycle state are synchronized.

## 7. Crushing traps

The crusher follows a bounded triangle-wave vertical path. Server-side overlap with its current rectangle invokes the same respawn flow used by spikes and pits. Its position is included in snapshots for reconnects.

## 8. Spike and pit behavior

The existing configured spike hazard uses `playerInHazard`; falling below the established threshold remains pit behavior. Both enter the existing delayed server respawn path, which clears inventory/effects and restores the shared checkpoint when available. No separate hazard respawn was added.

## 9. Server-authoritative environment simulation

Each race advances obstacle state before player movement at the fixed 1/60-second step. Dynamic platform collision/carry, falling-block activation/reset, crusher contact, spike contact, pickup availability, checkpoint progression, and finish detection are server-owned. Protocol v2 snapshots validate and carry obstacle IDs, rectangles, and falling-block states. Clients cannot submit obstacle positions or claim interactions. Environment state remains in memory; PostgreSQL is unchanged.

## 10. Camera and background

Smooth local-player following and full-level bounds remain. Decorative hills and cloud bands use reduced scroll factors for parallax. Platform tops, spike teeth, route labels, and a finish flag improve readability. No split-screen or audio was added.

## 11. HUD improvements

The existing two-slot inventory and contextual **USE POWER** flow remain. The HUD adds level name, approximate horizontal progress, shared checkpoint, racer count, and local online/respawning/finished status. Obstacle, checkpoint, and pickup appearance updates from snapshots. Existing mobile controls and responsive styles remain.

## 12. Database changes

None. No migration was added or edited, and no data was reset. Migrations 001–004 remain applied.

## 13. Automated test results

- Shared simulation: 18 passed, including deterministic obstacle paths, endpoint reversal, and moving-platform carry/jump behavior.
- Shared contracts: 1 passed.
- Server unit tests: 40 passed, including snapshot validation and obstacle state on reconnect, as well as existing respawn, checkpoint/pickup, finish, and three-player coverage.
- PostgreSQL/WebSocket integration: 8 passed.
- Client tests: 16 passed.
- Total: 83 passed; none skipped.

The new automated environment tests do not fully exercise every browser interaction, including visual trap timing and complete two-/three-session traversal. Those remain manual checks.

## 14. Exact commands executed

| Command                          | Result                                                              |
| -------------------------------- | ------------------------------------------------------------------- |
| `npm.cmd test`                   | PASS — 83 tests, none skipped                                       |
| `npm.cmd run typecheck`          | PASS — all workspaces                                               |
| `npm.cmd run lint`               | PASS                                                                |
| `npm.cmd run format:check`       | PASS                                                                |
| `npm.cmd run architecture:check` | PASS                                                                |
| `npm.cmd run build`              | PASS — all workspaces; existing Phaser bundle size advisory remains |
| `npm.cmd run migration:status`   | PASS — migrations 001–004 applied                                   |

Node tests and migration status needed approved process access because the restricted Windows sandbox failed during Node's user-information lookup before commands started.

## 15. Manual browser test results

**NOT RUN.** No interactive browser or browser automation session was available. Full two-/three-player completion, moving-platform feel, obstacle timing, and mobile HUD placement need hands-on verification.

## 16. Known issues

- Phaser's production bundle still triggers Vite's existing 500 kB advisory.
- Multiplayer presentation and obstacle feel have not been visually play-tested.
- Moving-platform prediction uses existing reconciliation and may need tuning after browser testing.
- Environment state is in memory and follows the existing single-server runtime model.

## 17. Phases 1–6 preserved

Health/configuration/database foundation, single-player `/play`, guest/lobby behavior, race lifecycle, authoritative movement, and Phase 6 physics/checkpoint/respawn/power-up/results behavior remain in place. No applied migration changed.

## 18. Phase 8 boundary

Phase 7 implementation and automated checks are complete to the extent described above. No Phase 8 feature was started. This report does not claim manual browser completion; review this report and hands-on behavior before authorizing Phase 8.
