# BBM Phase 3 completion report

## 1. Summary

Added the first persistent multiplayer lobby foundation. Guests create a profile and receive a random bearer token once; only its SHA-256 hash is stored in PostgreSQL. Authenticated guests can create or join private rooms, see authoritative presence and readiness, leave, and reconnect. Rooms hold at most three guests, require at least two connected ready guests before the host can request preparation, expire after inactivity, and close when the host leaves. `prepare_to_start` reports eligibility only; it does not start a race. The Phase 2 platformer remains at `/play`.

No race simulation, multiplayer movement synchronization, matchmaking, room browser, spectator role, or Phase 4 feature was added.

## 2. Architecture

- Shared contracts define protocol v1 and runtime validation for both client and server messages.
- The server domain owns guest profile validation and room capacity, host, presence, readiness, grace, expiry, and closure rules.
- Application services depend on repository, clock, token, ID, room-code, and rate-limit ports.
- PostgreSQL persists guest profiles, token hashes, rooms, room membership, readiness, presence, and revisions. Transactions and row locks serialize membership changes; database constraints enforce room capacity and one active room per guest.
- HTTP creates and updates guest profiles. The WebSocket gateway authenticates guests, processes room commands in order for each socket, publishes authoritative snapshots, and rejects invalid or unsupported protocol messages.
- The browser lobby uses HTTP for guest setup and WebSocket for rooms. It persists the returned token locally and does not put it in a URL. The existing single-player scene remains separate.

The WebSocket transport uses `/ws`, a maximum 8 KiB message, origin checks, per-IP message/join/create limits, and versioned JSON envelopes. The initial rate limiter is process-local. Production configuration requires HTTPS origins, a database URL, and `TRUST_PROXY=true` for the configured HTTPS proxy.

## 3. Persistence and lifecycle

Migration `002_multiplayer_lobby.sql` was added and applied to the configured local PostgreSQL database. `001_initial.sql` was not modified. The six-character room code uses an alphabet that omits visually ambiguous characters. Active rooms expire after 30 minutes of inactivity by default, with a five-second sweep interval. A disconnected host gets a 30-second grace period. Open rooms are closed during server startup so a previous process cannot leave a room active indefinitely. These intervals can be changed with `ROOM_IDLE_MINUTES`, `HOST_GRACE_SECONDS`, and `ROOM_SWEEP_SECONDS`.

Guests may have one active room membership. A guest reconnecting with the same bearer token resumes that membership and receives the current snapshot. Connection IDs prevent an older socket's delayed close event from marking the newer connection disconnected.

## 4. User experience

The root route provides the guest profile and room lobby. It supports creating a room, joining by code, copying the code, seeing connected/ready members, toggling readiness, leaving, and host-only preparation. It handles session restoration, server errors, socket disconnects, and reconnect actions. The lobby has responsive layout and keyboard focus styles. `/play` continues to load the Phase 2 Phaser platformer.

## 5. Files added or changed

Added application ports/services, guest and room domain modules, PostgreSQL guest and room repositories, security adapters, the WebSocket gateway, shared protocol contracts, the lobby UI and socket client, migration `002_multiplayer_lobby.sql`, and lobby unit/integration tests. Updated server configuration/composition/shutdown, root and client package scripts/dependencies, client route bootstrapping and styles, `.env.example`, `docs/ARCHITECTURE.md`, and this report. The local `.env` remains ignored and is not included in source or report content.

## 6. Verification

| Check                            | Result | Notes                                                                                                              |
| -------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------ |
| `npm test`                       | PASS   | Shared contracts 1, server unit 17, server/PostgreSQL integration 3, client 12; 33 total.                          |
| `npm run typecheck`              | PASS   | Shared contracts, server, and client.                                                                              |
| `npm run lint`                   | PASS   | ESLint completed without findings.                                                                                 |
| `npm run format:check`           | PASS   | Prettier check.                                                                                                    |
| `npm run architecture:check`     | PASS   | Existing server import-boundary scanner passed.                                                                    |
| `npm run build`                  | PASS   | Shared contracts, server, and client production builds. Phaser bundle advisory remains from Phase 2.               |
| `npm run migrate`                | PASS   | Applied `002_multiplayer_lobby.sql` to local PostgreSQL.                                                           |
| `npm run migration:status`       | PASS   | Expected both initial and lobby migrations applied.                                                                |
| PostgreSQL/WebSocket integration | PASS   | Real database; guest creation, room authority, readiness, membership limit, reconnect, concurrent final-slot join. |
| Manual browser lobby check       | PASS   | User confirmed the lobby works in their browser. This was a manual check, not browser automation.                  |

The full test run needed approved process access because the restricted Windows sandbox causes the Node `tsx` runner to fail while querying Windows user information. No database contents were reset; only the new additive migration was applied.

## 7. Coverage and limitations

Unit tests cover profile normalization and color validation, guest token hashing/authentication, room-code generation, room capacity and membership, readiness, host behavior, idle/grace expiry, stale connection protection, and runtime protocol parsing. Integration tests use PostgreSQL and real WebSocket clients to exercise authoritative room behavior and concurrent joins. Client tests retain Phase 2 movement coverage and the single-player route smoke check.

The client UI was compiled, its protocol integration was exercised through server-side WebSocket clients, and the user manually confirmed the lobby works in a browser. Specific desktop/mobile layout checks and a complete room-flow checklist were not separately recorded. Rate limits live in process memory and do not coordinate across multiple server instances. Production HTTPS validation trusts the configured proxy header when `TRUST_PROXY=true`; deployment must ensure that header is set only by the trusted proxy. There is no cross-process socket broadcast or multi-instance room coordination beyond PostgreSQL transactions.

## 8. Manual verification

The user manually checked the lobby in a browser and confirmed that it works. For further verification, run `npm run dev:server` and `npm run dev:client`, then create two guest profiles in separate browser sessions, create a room from one, join by code from the other, mark both ready, and verify the host can request preparation. Verify a third guest can join and a fourth is rejected. Test host and non-host departures, reload/reconnect, and the `/play` route. On mobile, verify the lobby controls fit portrait and landscape layouts.

## 9. Phase 4 boundary

No race start, synchronized movement, gameplay WebSocket events, countdown, finish order, or results persistence was introduced. `prepare_to_start` is only a readiness check.
