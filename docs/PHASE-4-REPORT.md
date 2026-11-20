# BBM Phase 4 completion report

## 1. Summary

Implemented an authoritative server-side race lifecycle for the Phase 3 lobby. The host can start a race once at least two players are connected and ready. The server persists a three-second countdown, broadcasts one shared absolute start deadline, moves the race to `InProgress` at that deadline, and cancels it after 120 seconds. Reconnects receive the current persisted race snapshot. Host departure, room expiry, host-grace expiry, and server restart cancel an active race with a recorded reason. A timeout leaves the room open so its players can ready up and start a new session.

The lobby displays countdown and race state. The `/play` single-player platformer remains available and has no race networking. No movement synchronization, finish order, score, results, or Phase 5 feature was added.

## 2. Changed-file tree

```text
apps/
├── client/
│   └── src/
│       ├── lobby/mount-lobby.ts
│       └── style.css
├── server/
│   ├── src/
│   │   ├── application/
│   │   │   ├── ports/{interval-scheduler.ts,race-repository.ts}
│   │   │   └── services/race-service.ts
│   │   ├── composition/create-server.ts
│   │   ├── domain/
│   │   │   ├── entities/{race-session.ts,room.ts}
│   │   │   └── errors/domain-error.ts
│   │   ├── index.ts
│   │   ├── infrastructure/
│   │   │   ├── configuration/{config.ts,interval-scheduler.ts}
│   │   │   └── persistence/postgres/
│   │   │       ├── migrations/003_race_sessions.sql
│   │   │       ├── postgres-race-repository.ts
│   │   │       └── postgres-room-repository.ts
│   │   └── presentation/websocket/room-websocket-gateway.ts
│   ├── tests/
│   │   ├── integration/races.test.ts
│   │   └── unit/{lobby-domain.test.ts,protocol.test.ts,race-session.test.ts}
│   └── package.json
├── packages/shared-contracts/src/index.ts
├── .env.example
└── docs/{ARCHITECTURE.md,PHASE-4-REPORT.md}
```

No files were deleted. Existing migrations `001_initial.sql` and `002_multiplayer_lobby.sql` were not changed.

## 3. Race lifecycle and authority

Race sessions have the states `Waiting`, `Countdown`, `InProgress`, `Finished`, and `Cancelled`. Only the server can transition persisted state. The start command locks the room in PostgreSQL, verifies the current host connection and readiness, and creates or returns the active session. Repeated start requests are idempotent. Room membership uses the same room lock and rejects new members during Countdown or InProgress, so a join cannot race past a start.

The default countdown is three seconds. The server stores and broadcasts its absolute deadline; clients estimate server clock offset and render the remaining time locally. Client timers are display-only. The official start time is the countdown deadline, regardless of when a server polling callback runs. The timeout is 120 seconds from that official start.

A shared 50 ms scheduler runs only while at least one race is active. It advances due persisted transitions and stops when no active races remain or during shutdown. Reconnect sends the existing snapshot and deadline; it does not start a new countdown.

## 4. Timeout, cancellation, and recovery

- Timeout transitions the session to `Cancelled` with reason `Timeout`. The room remains open; players may update readiness and the host can create a new session with a new race ID.
- Host leave closes the room and cancels its active race as `HostLeft`.
- Room idle expiry or host-grace expiry cancels the active race as `RoomExpired` before room closure.
- Server startup recovery and graceful shutdown cancel active races as `ServerRestart`.
- A non-host disconnect or leave does not cancel an active race. The host may reconnect within the existing grace period and receive the same race snapshot.
- Terminal sessions do not transition again. Cancellation reasons and timestamps are persisted.

## 5. WebSocket protocol and lobby

Protocol v1 adds `start_race` and `get_race_snapshot` client messages. Authenticated and reconnect responses include the current race snapshot; server events publish countdown start, state changes, official start, cancellation, and explicit snapshots. Shared runtime parsing validates race IDs, revisions, states, timestamps, and event/state consistency. Existing bearer-token authentication remains in place; no token is placed in a URL or race payload.

The lobby exposes a host-only **Start Race** control, enabled when the room has at least two connected ready players. It displays countdown/race state and cancellation reason. The existing **Check readiness** action remains a readiness check, not a race start.

## 6. Persistence and migration

Added `003_race_sessions.sql`, an additive migration creating the session table, state and timestamp constraints, due-transition indexes, and a partial unique index limiting each room to one active race. Repository transitions are persisted transactionally and queries use parameters. Migrations `001_initial.sql` and `002_multiplayer_lobby.sql` remain unchanged.

The migration was applied to the configured local PostgreSQL database without resetting existing data. Final `migration:status` reported all three migrations applied.

Race timing defaults are configurable with `RACE_COUNTDOWN_SECONDS` (3), `RACE_TIMEOUT_SECONDS` (120), and `RACE_TICK_MS` (50). These settings are documented in `.env.example`.

## 7. Security and data review

Race commands continue to require the authenticated guest token and server-side room membership/host checks. The server supplies race IDs, deadlines, state, and cancellation reason; clients cannot choose or override them. SQL values use parameterized queries, and database uniqueness/constraints backstop active-session invariants. A workspace scan found no occurrence of the supplied database password outside the ignored `.env`. The workspace has no `.git` metadata, so a Git diff/status review was unavailable.

## 8. Tests and verification

| Check                        | Result  | Evidence                                                                                      |
| ---------------------------- | ------- | --------------------------------------------------------------------------------------------- |
| `npm test`                   | PASS    | 43 tests: shared 1, server unit 24, PostgreSQL/server integration 6, client 12; none skipped. |
| `npm run typecheck`          | PASS    | All workspaces passed strict TypeScript checks.                                               |
| `npm run lint`               | PASS    | ESLint completed without findings.                                                            |
| `npm run format:check`       | PASS    | Prettier check passed before this report was added.                                           |
| `npm run architecture:check` | PASS    | Server import-boundary check passed.                                                          |
| `npm run build`              | PASS    | Shared contracts, server, and client built; Vite retained the Phaser bundle size advisory.    |
| `npm run migrate`            | PASS    | Applied `003_race_sessions.sql` to the configured local PostgreSQL database.                  |
| `npm run migration:status`   | PASS    | `001_initial.sql`, `002_multiplayer_lobby.sql`, and `003_race_sessions.sql` reported applied. |
| Browser race play-through    | NOT RUN | No interactive browser session or browser automation was available.                           |

The full test command required approved process access because the restricted Windows sandbox can cause Node's `tsx` runner to fail while querying Windows user information. Integration tests used PostgreSQL and real WebSocket clients with an injected clock and scheduler; they did not wait through real countdown or timeout durations.

## 9. Automated coverage

Unit coverage exercises legal and illegal race transitions, countdown deadline behavior, official start and timeout calculation, terminal cancellation, protocol validation, and joining/readiness rules. PostgreSQL/WebSocket integration coverage exercises eligible and rejected starts, duplicate start requests, common client deadlines, joins during a race, reconnect snapshots, timeout persistence and retry in the same room, host-leave cancellation broadcasts, restart recovery, host-grace expiry, and scheduler cleanup. Existing lobby, health, client, and Phase 2 movement tests also passed.

These tests do not establish visual browser behavior or human timing feel. The local countdown display and room flow still need a browser play-through.

## 10. Preserved scope and limitations

Phase 1 database/health foundation, Phase 2 single-player platformer, and Phase 3 guest/lobby foundation remain in place. `/play` remains separate from the lobby race session. No synchronized movement, race physics, finish detection, rankings, results persistence, or Phase 5 content was implemented. The production bundle continues to trigger Vite's advisory because Phaser is included.

Manual verification should use two or more browser sessions: create/join and ready a room, start a race, compare displayed countdowns, refresh/reconnect during countdown and progress, wait for timeout, and verify a later race can start. Also check host departure and room closure behavior. This manual checklist is outstanding; no browser result is claimed here.

## 11. Phase boundary

Phase 4 race lifecycle and synchronized countdown are implemented and automated checks passed. The work stops before Phase 5. Please review this report and the browser behavior before authorizing Phase 5.
