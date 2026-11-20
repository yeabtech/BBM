# BBM Phase 2 completion report

## 1. Summary

Replaced the Phase 1 placeholder scene with a local single-player platforming prototype. The player accelerates and brakes horizontally, air-steers, rolls visually, jumps and double-jumps, collides with platforms, resets after hazards or falling, and is followed by a smooth bounded camera. Keyboard and multi-touch controls are wired. The level has multiple platforms, gaps, a marked hazard, and a visual-only finish marker. No Phase 3 multiplayer or networking features were added.

## 2. Relevant client tree

```text
apps/client/
├── index.html
├── src/
│   ├── main.ts
│   ├── style.css
│   └── game/
│       ├── create-game.ts
│       ├── input/{game-input.ts,input-state.ts}
│       ├── level/level-config.ts
│       ├── physics/movement.ts
│       ├── rendering/{build-ball-texture.ts,build-level.ts}
│       ├── scenes/platformer-scene.ts
│       └── state/{movement-config.ts,player-state.ts}
├── tests/{foundation.test.mjs,movement.test.ts}
├── package.json
└── tsconfig.json
```

## 3. Architecture and physics decisions

- Phaser 3.90.0 Arcade Physics is the only physics system. Arcade owns gravity, integration, platform collision, and world-bound resolution.
- Pure functions in `game/physics/movement.ts` calculate bounded horizontal velocity and consume deliberate jump edges. The scene supplies velocity to the Arcade body; it does not apply a second gravity or position integration.
- `GameInput` adapts Phaser keyboard state and touch button events to a small normalized input frame. `TouchInputState` tracks multiple pointer IDs and consumes jump as an edge.
- The ball texture is circular with a contrasting rotation mark. Its centered 26×26 square Arcade body is smaller than the 32×32 drawing and gives stable flat platform contact. This is a deliberate collision shape, not a circular body.
- The test-level data and validation are separate from scene rendering. Platforms and hazards are built from configured geometry.
- Browser/network transport is not instantiated. Server code, server Domain and Application boundaries, PostgreSQL integration, and shared contracts were not changed for gameplay.
- Client separation and the limits of the existing automated architecture check are documented in `docs/ARCHITECTURE.md`.

## 4. Movement settings and tuning

Values are in pixels, seconds, and pixels per second in `apps/client/src/game/state/movement-config.ts`:

| Setting                      |   Initial value |
| ---------------------------- | --------------: |
| Maximum horizontal speed     |        270 px/s |
| Ground acceleration          |      1500 px/s² |
| Ground deceleration          |      1850 px/s² |
| Air acceleration             |       900 px/s² |
| Air control multiplier       |            0.72 |
| Arcade gravity               |      1050 px/s² |
| Ground jump velocity         | 510 px/s upward |
| Double jump velocity         | 470 px/s upward |
| Maximum jumps before landing |               2 |
| World                        |   2400 × 900 px |
| Fall reset threshold         |      y = 700 px |

Horizontal integration uses the frame delta capped at 50 ms, so a single stalled frame cannot add an unbounded velocity change. Horizontal world bounds and the top bound are enabled; the bottom is intentionally open so the development fall reset can trigger. Jump count only resets from Arcade downward ground contact.

## 5. Files created or modified

Created the client input, level, physics, rendering, state, and platformer-scene modules listed above, the movement unit tests, and this report. Updated `apps/client/index.html`, `apps/client/src/style.css`, `apps/client/src/game/create-game.ts`, `apps/client/package.json`, `apps/client/tests/foundation.test.mjs`, and `docs/ARCHITECTURE.md`. `package-lock.json` reflects the client test runner dependency. The existing server and PostgreSQL migration code were left intact.

## 6. Commands executed and results

| Command/check                    | Result  | Details                                                                                                                                                        |
| -------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm.cmd run dev:client`         | PASS    | Vite started at `http://127.0.0.1:5173`; `/`, `/src/main.ts`, and the platformer scene module returned HTTP 200.                                               |
| `npm.cmd test`                   | PASS    | Shared contract 1, server unit 5, PostgreSQL integration 1, and client 12 passed; none skipped.                                                                |
| `npm.cmd run typecheck`          | PASS    | Shared contracts, server, and client passed strict TypeScript checks.                                                                                          |
| `npm.cmd run lint`               | PASS    | ESLint completed without findings.                                                                                                                             |
| `npm.cmd run format:check`       | PASS    | Prettier check passed.                                                                                                                                         |
| `npm.cmd run architecture:check` | PASS    | Existing server boundary scanner passed; client separation is described in `docs/ARCHITECTURE.md`.                                                             |
| `npm.cmd run build`              | PASS    | All workspaces compiled and the Vite production build completed. Vite emitted its 500 kB advisory; the Phaser bundle is about 1.22 MB uncompressed.            |
| PostgreSQL integration           | PASS    | Existing test connected to the configured PostgreSQL 17 database and executed `SELECT 1`.                                                                      |
| Browser/Arcade play-through      | NOT RUN | No browser or browser automation package was available. Static Vite responses and production bundling do not prove scene initialization or collision behavior. |

The test command was run with approved process access because the restricted Windows process sandbox can make `tsx` fail while Node queries user information. The PostgreSQL integration test ran and passed in the same full test suite.

## 7. Automated test coverage

The client tests cover horizontal speed capping, acceleration and release deceleration, 30/60 update-rate consistency, reversal, grounded jump eligibility, double-jump eligibility, rejection of a third jump, landing reset, held-input edges, config validation, multi-touch input and release, and level bounds/content validation. The previous Phase 1 client smoke test was updated and remains in the suite. Server health and PostgreSQL integration tests also passed.

These are tests of pure movement/configuration/input logic and server services. They do not simulate Phaser Arcade collision callbacks, a browser keyboard device, or real touch hardware.

## 8. Known limitations

- Desktop and mobile presentation and hands-on gameplay remain unverified because no browser was available. The touch layout adapts through coarse-pointer and narrow-screen CSS, but hardware touch behavior is not claimed as tested.
- Arcade Physics collision behavior, camera feel, landing feel, hazards, and reset animation need the manual play-through below.
- The production bundle exceeds Vite's advisory threshold because Phaser is included in the client bundle.
- No coyote time or jump buffering is implemented; jumps require grounded contact for the first jump and a new press edge for the second.

## 9. Manual test checklist

Run `npm run dev:client`, open the local Vite URL in a browser, and try:

- [ ] A/Left Arrow and D/Right Arrow movement; release input and check stopping.
- [ ] Reverse direction while moving and confirm it decelerates then moves the other way.
- [ ] Jump from the starting platform; press jump again in the air for a double jump.
- [ ] Press jump a third time before landing; confirm it is ignored.
- [ ] Land and confirm the next jump is available.
- [ ] Approach platform edges and verify side contact does not reset jump count.
- [ ] Land on the raised platforms and traverse both gaps.
- [ ] Touch the marked hazard; confirm the brief reset to the start.
- [ ] Fall below the level; confirm the safe development reset.
- [ ] Move and jump while observing smooth camera follow and world-edge behavior.
- [ ] Press R to reset and Escape to pause/resume.
- [ ] On a touch device, hold left/right, tap jump twice, combine movement and jump, release controls, and verify no stuck input.
- [ ] Check desktop and portrait/landscape mobile layouts and that page gestures outside controls remain available.

None of these manual checks are marked passed in this report.

## 10. Desktop and mobile verification status

- Desktop browser gameplay: NOT RUN.
- Mobile browser layout and actual touch hardware: NOT RUN.
- Vite client server startup and module serving: PASS.
- Phaser production compilation: PASS.

## 11. Phase 3 scope confirmation

No room codes, guest room management, WebSocket gameplay, multiplayer synchronization, race systems, persistence, or other Phase 3 feature was introduced.
