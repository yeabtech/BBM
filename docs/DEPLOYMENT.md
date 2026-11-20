# BBM build and deployment notes

BBM is prepared for deployment but is not deployed by this repository. By default the API and browser client are separate artifacts: the Node server serves the API and `/ws`, and the production Vite build in `apps/client/dist` is served by an HTTPS static web server or reverse proxy. Configure the proxy to forward `/ws` as a WebSocket upgrade and to preserve the original HTTPS scheme.

Optionally, setting `CLIENT_DIST=apps/client/dist` makes the existing Node server serve that build from the same origin as `/api` and `/ws` (used for offline hotspot play). This is a single extra static middleware, not a second deployment architecture; it serves plain HTTP and is intended for trusted private networks only. The project does not select a hosting vendor.

## Local development

1. Install Node.js 22.x and PostgreSQL 16 or 17.
2. Copy `.env.example` to `.env`, set a local `DATABASE_URL` if persistence is needed, and keep `DATABASE_REQUIRED=false` for optional DB development.
3. In separate terminals run `npm.cmd run dev:server` and `npm.cmd run dev:client`.
4. Visit `http://127.0.0.1:5173`; the API health endpoint is `http://127.0.0.1:3000/api/health`.

The single-player `/play` scene can be opened without connecting to multiplayer. Persistent room features require PostgreSQL and applied migrations.

## Windows LAN play

LAN binding is disabled by default. For a trusted home/private network or hotspot, set `LAN_ENABLED=true`, `HOST=0.0.0.0`, `DATABASE_REQUIRED=true`, and `CLIENT_DIST=apps/client/dist` in the host's server environment, then run `npm.cmd run build` and `npm.cmd run start:server` as described in [LAN-PLAY.md](LAN-PLAY.md). `HOST` may instead be set to an IP assigned to a local interface. The lobby reports private IPv4 addresses returned by `/api/lan-info` and, because the server hosts the client, shows the full `http://<host-ip>:<port>/` link plus the room code. It does not use broadcast discovery. Joining players open that link, connect to the same address and port, create guest identities, and join by private room code. Without `CLIENT_DIST`, the client comes from Vite's Network URL and its exact origin must be in `CLIENT_ORIGINS`.

On Windows, permit only the BBM server port (`3000` by default) — or ports `3000` and `5173` when the Vite dev client is used — on the Private firewall profile and local subnet only. Never disable Windows Firewall or permit these ports on Public networks. Router guest/client isolation, VPNs, and endpoint firewalls may prevent peer connections. LAN multiplayer requires the host's local PostgreSQL instance and applied migrations; no internet service or remote asset host is used by a game session. This development LAN setup uses HTTP and should only be used on a trusted private network; production keeps HTTPS and the existing exact-origin and trusted-proxy requirements.

## Production build and startup

Use Node.js 22.x. Store the API environment variables in the server's secret manager or process environment. Do not put `DATABASE_URL` or guest tokens into Vite variables or a client bundle.

```powershell
npm ci
npm.cmd run build
npm.cmd run migration:status
# Only when status reports a pending additive migration:
npm.cmd run migrate
npm.cmd run start:server
```

Set `VITE_API_BASE_URL` to the public HTTPS API origin at client build time, then run `npm.cmd run build --workspace @bbm/client`; publish the resulting `apps/client/dist` directory to an HTTPS static origin. The API's `CLIENT_ORIGINS` must contain that exact origin. Unless `CLIENT_DIST` is set (private-network hotspot hosting only), the API server does not serve the static client files.

The compiled server build copies SQL migration files into `apps/server/dist`, so production migration commands use Node's compiled output and do not require the development `tsx` runner. `npm.cmd run migrate` only applies pending migrations; inspect status first. There is no down-migration command.

## Environment variables

| Variable                 | Required use               | Notes                                                                                                       |
| ------------------------ | -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`               | Production                 | Set to `production` for production validation and HTTPS enforcement.                                        |
| `HOST`                   | Optional                   | Bind address; defaults to `127.0.0.1`. A non-loopback bind requires `LAN_ENABLED=true`.                     |
| `LAN_ENABLED`            | Optional                   | Defaults to `false`. Explicitly permits a non-loopback bind; with no `HOST`, binds to `0.0.0.0`.            |
| `CLIENT_DIST`            | Optional                   | Directory of a built client (`apps/client/dist`) to serve from the API port; must contain `index.html`.     |
| `PORT`                   | Optional                   | API HTTP and WebSocket port; default `3000`.                                                                |
| `DATABASE_URL`           | Required in production     | PostgreSQL URL. Keep it server-side and URL-encode special credential characters.                           |
| `DATABASE_REQUIRED`      | Required in production     | Must be `true`; startup performs a DB health check and fails closed when unavailable.                       |
| `LOG_LEVEL`              | Optional                   | Pino level; default `info`.                                                                                 |
| `CLIENT_ORIGINS`         | Required deployment policy | Comma-separated exact origins. Production entries must use `https://`.                                      |
| `TRUST_PROXY`            | Required in production     | Must be `true` when HTTPS terminates at the trusted reverse proxy. Do not enable behind an untrusted proxy. |
| `ROOM_IDLE_MINUTES`      | Optional                   | Room expiry interval; default `30`.                                                                         |
| `HOST_GRACE_SECONDS`     | Optional                   | Host reconnect grace; default `30`.                                                                         |
| `ROOM_SWEEP_SECONDS`     | Optional                   | Room expiry sweep; default `5`.                                                                             |
| `RACE_COUNTDOWN_SECONDS` | Optional                   | Existing race countdown; default `3`.                                                                       |
| `RACE_TIMEOUT_SECONDS`   | Optional                   | Existing race timeout; default `120`.                                                                       |
| `RACE_TICK_MS`           | Optional                   | Existing scheduler poll interval; default `50`; this is not the simulation tick rate.                       |
| `VITE_API_BASE_URL`      | Client build time          | Public HTTPS API origin compiled into the browser bundle. It must never contain credentials.                |

`.env.example` contains development-safe placeholders only. The actual `.env` file is ignored by Git.

## Health and operations

- `GET /api/health` confirms the API process responds.
- `GET /api/health/db` checks PostgreSQL and returns 503 when unavailable.
- WebSocket endpoint: `/ws`; the reverse proxy must support upgrades and use the same allowlisted browser origin.
- On SIGTERM or SIGINT, the server first stops accepting HTTP connections, then drains WebSockets and applies the established `ServerRestart` race cancellation, then closes PostgreSQL.
- Back up PostgreSQL with the database operator's consistent backup procedure before applying migrations. Verify a restore in a separate database before relying on it. No data reset or destructive migration is part of deployment.

## Troubleshooting

- `ConfigurationError`: check the listed production requirements, especially `DATABASE_REQUIRED=true`, an HTTPS `CLIENT_ORIGINS` entry, and `TRUST_PROXY=true`.
- API health succeeds but DB health returns 503: check the private network route, URL encoding, PostgreSQL TLS policy, credentials, and connection limit.
- Browser cannot join rooms: check the built `VITE_API_BASE_URL`, exact CORS/WebSocket origin, HTTPS/WSS proxy upgrade, and that migrations are applied.
- Migration files are missing after a build: rebuild the server workspace using `npm.cmd run build --workspace @bbm/server`; the build copies the source SQL files into `dist`.
- Rate limits are in-memory and process-local. A multi-instance deployment does not share limits and requires a separate shared limiter design before horizontal scaling.

## Bounded local load procedure

`npm.cmd run load:test` runs synthetic WebSocket clients only against a loopback URL. Use a dedicated disposable local PostgreSQL database for this procedure: server startup intentionally closes old open rooms and cancels old active races, and the load runner creates guest/race records that it retains. Do not aim it at production or a shared development database.

1. Create an isolated database and apply the existing migrations with `npm.cmd run migrate`.
2. Start a local server from this workspace, with `HOST=127.0.0.1`, `NODE_ENV=test`, `DATABASE_URL` set to that isolated database, `DATABASE_REQUIRED=true`, `RACE_COUNTDOWN_SECONDS=1`, `RACE_TIMEOUT_SECONDS=5`, and `ROOM_SWEEP_SECONDS=1`. These shortened deadlines make timeout results reproducible. The run does not move players or claim traversal performance.
3. Optionally set `BBM_LOAD_TEST_ROOMS` from 1–5, `BBM_LOAD_TEST_PLAYERS` to 2 or 3, `BBM_LOAD_TEST_CYCLES` from 1–5, and `BBM_LOAD_TEST_RESULT_TIMEOUT_MS` from 5,000–300,000. The tool enforces no more than five room starts per run to remain within the existing room-create limit. It will create missing synthetic guests through the local guest API; at most five can be created per source IP in the ten-minute window. `BBM_LOAD_TEST_TOKENS` may supply a JSON array of already-created guest tokens for a larger concurrent room wave. Tokens are read from the environment and never printed.
4. Run `npm.cmd run load:test`. The tool reports elapsed time, completed timeout races, received WebSocket messages/bytes, gameplay snapshot count and client JSON parse time, protocol errors, DB health before/after, and request RTT percentiles. Non-finished players are expected because the controlled workload exercises timeout completion, not course traversal.
5. Capture server CPU and working-set memory separately with Windows Performance Monitor or Task Manager against the API process; the script does not introspect the server process. Record PostgreSQL logs and `/api/health/db` results with the same run.
6. Verify the isolated DB migration status afterward. Discard the disposable database only after preserving any measurements needed for comparison.

This procedure is bounded to at most five rooms per wave and five race cycles, with three players maximum in each room. The script does not assert a production player-capacity target. It does not provide a sustained multi-hour test; run multiple reviewed bounded runs if a longer soak is needed.
