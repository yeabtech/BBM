# Play BBM on the same Wi-Fi network or hotspot

BBM LAN/hotspot play runs the existing API, WebSocket gateway, PostgreSQL persistence, and authoritative race simulation on one host computer. LAN binding is opt-in; the API stays on `127.0.0.1` by default.

The recommended layout has the host computer run everything (PostgreSQL, API, WebSocket, and the built client). Other devices load the client from the host's own API port:

```text
Phone / second PC  ──►  http://<host-ip>:<port>/   (client, HTTP)
                       ws://<host-ip>:<port>/ws     (lobby and race WebSocket)
                       postgres          (host-local only)
```

No internet, cloud API, DNS, matchmaking service, or remote asset host is used.

## Quick start: one command, then one button

```powershell
npm install        # first time only
npm run host
```

That builds the client, starts the server (API, WebSocket and game page on one port), and opens the lobby. Then:

1. Press **Start hosting** in the lobby. The server switches from this-computer-only to accepting players on your Wi-Fi/hotspot. No `.env` editing and no address typing.
2. The lobby shows the link to share, for example `http://192.168.1.20:3000/`, with a **Copy link** button.
3. Type a name, press **Create guest**, then **Create room** and copy the six-character room code.
4. Other players open the link on their device, choose a name, press **Create guest**, enter the room code, and press **Join room**.
5. The host presses **Start Race** when at least two connected players are ready (a third can join before the start).

Everyone must be on the same Wi-Fi network or hotspot as the host computer.

## At a glance

|                | Before Start hosting | After Start hosting                          |
| -------------- | -------------------- | -------------------------------------------- |
| Bind           | `HOST=127.0.0.1`     | all interfaces on the same port, same server |
| Client         | served by the API    | served by the API (unchanged)                |
| Reachable from | This computer only   | Devices on the same private network/hotspot  |
| Players        | Same computer        | 2–3 (minimum 2 to start)                     |

`LAN_ENABLED=true` and `HOST=0.0.0.0` in the environment do the same thing at startup for scripted deployments; the button is the normal path.

## Manual host setup

1. Install Node.js 22.x and PostgreSQL 16 or 17. Start PostgreSQL and make sure the BBM database exists with migrations 001–004 applied. Check with `npm.cmd run migration:status`; **do not reset** a database containing data.
2. In `.env`, set `DATABASE_URL` and `DATABASE_REQUIRED=true`.
3. Run `npm run build`, then start the server with the client hosted by the API:

   ```powershell
   $env:CLIENT_DIST="apps/client/dist"
   npm run start:server
   ```

   Without `CLIENT_DIST`, other devices are given a broken client: Vite's dev server (`npm run dev:client`, port 5173) serves only the page and has **no** `/api` routes, so creating a guest fails with `POST http://<host>:5173/api/guests 404`. If you must use the Vite dev client on another device, expand **Joining a different computer?** in the lobby, enter the API's address and port, press **Connect to server**, and only then create the guest.

4. Press **Start hosting** in the lobby. It shows the shareable link, for example `http://192.168.1.20:3000/`.
5. If Windows Firewall prompts, allow Node.js only on **Private networks**. See [Windows Firewall](#windows-firewall-private-network-only).
6. Create a guest, create a private room, and share the room code. Other players open the link, create a guest, and join with the code.
7. The host presses **Start Race** once at least two connected players are ready.

## Using a Windows mobile hotspot

1. Settings → Network & internet → Mobile hotspot → turn on **Mobile hotspot** (or **Share my internet connection**). Choose Wi-Fi.
2. The hotspot network adapter (often `Microsoft Wi-Fi Direct Virtual Adapter` / a `192.168.137.x` address) becomes the address other devices should use. Check with `ipconfig`; the hotspot adapter is the one serving `192.168.137.1` by default.
3. Start BBM as above. The lobby lists the private addresses it found; pick the hotspot adapter's address. Ignore virtual adapters created by Hyper-V, VirtualBox, Docker, VPNs, or WSL — they usually cannot reach other devices.
4. On the phone, connect to the hotspot Wi-Fi and open `http://192.168.137.1:3000/` in the browser.
5. If Windows asks about network discoverability when enabling the hotspot, choose a **Private** network profile.

Hotspot sharing does not require the host computer to have internet access; devices can still reach each other while the hotspot is offline.

## Using an Android phone hotspot with a Windows host

1. Phone → Settings → **Hotspot & tethering** → **Wi-Fi hotspot** → enable it. (USB tethering also works if Windows installs the RNDIS network adapter.)
2. On the Windows host, connect to the phone's hotspot Wi-Fi. Find the address `ipconfig` assigns to that Wi-Fi adapter — typically `192.168.43.x`, `192.168.137.x`, or `192.168.x.x` depending on the phone; the router's own address (`192.168.43.1`) is **not** the host.
3. Run `npm run build`, set `LAN_ENABLED=true`, `HOST=0.0.0.0`, `CLIENT_DIST=apps/client/dist`, and start the server. Use the address from step 2 (confirm it appears in the lobby list).
4. Allow the server port on the Private profile for that adapter, then open `http://<host-ip>:3000/` on the phone.
5. Some phones isolate clients or require the hotspot to have an active internet/data connection before tethering. If the phone cannot load the page while the computer is otherwise fine, test from a second computer on the same hotspot first to isolate the phone's client isolation.

## Windows Firewall (Private network only)

The server listens on a TCP port (`3000` by default). To allow only BBM traffic from the local subnet, run PowerShell **as Administrator**:

```powershell
New-NetFirewallRule -DisplayName "BBM hotspot server" -Direction Inbound `
  -Protocol TCP -LocalPort 3000 -Action Allow -Profile Private `
  -RemoteAddress LocalSubnet
```

- **Never disable the firewall.** Do not open the port on the **Public** profile; public networks include cafés, hotels, and untrusted Wi-Fi.
- If Windows marks the hotspot/ethernet adapter as **Public**, either set it to Private (Settings → Network & internet → _adapter_ → Private) or add `-Profile Public` **only** for a network you control and trust.
- Remove the rule when finished: `Remove-NetFirewallRule -DisplayName "BBM hotspot server"`.
- If you keep the Vite dev server as the client host, allow port `5173` the same **Private**-only way.

## Troubleshooting

| Symptom                                                        | Check                                                                                                                                                                             |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A page loads but `/assets/<hash>.js` returns 404               | The HTML and built client assets are out of sync. Run `npm.cmd run build` and restart the BBM server, then reload the page on the phone.                                          |
| Lobby says "LAN hosting is disabled on this server."           | `LAN_ENABLED=true` in `.env`, then restart the server. A browser cannot widen a running bind.                                                                                     |
| Lobby shows no addresses                                       | `ipconfig` for the adapter on the shared network; enter the address manually. VPN/VirtualBox/Hyper-V adapters are excluded on purpose.                                            |
| Phone cannot open the page                                     | Same hotspot? Firewall rule on the right profile? Is the adapter Private? Try `ping <host-ip>` from another device.                                                               |
| "Could not reach that host or its origin was rejected."        | The address includes the server port; the client was loaded from the host's link (not `localhost`), and the server was started with `CLIENT_DIST`.                                |
| "The host server is running, but its database is unavailable." | Start PostgreSQL on the host; verify `GET /api/health/db`.                                                                                                                        |
| "Room code not found" / "Room is full"                         | Six-character code, correct host address, and fewer than three players in the room.                                                                                               |
| Works from the host, not from the phone                        | Router/hotspot **client isolation** (AP isolation), Windows firewall profile, or anti-virus network protection.                                                                   |
| `POST ...:5173/api/guests 404` on a phone                      | The page came from Vite, not the BBM server. Open `http://<host-ip>:3000/` (requires `CLIENT_DIST=apps/client/dist`), or connect to `<host-ip>` port `3000` first.                |
| Panel says "This page is not served by a BBM server"           | The client could not verify the selected API at `/api/lan-info`. Open the API address directly or enter the host address and port in the lobby, then press **Connect to server**. |

## Behavior and limits

- `LAN_ENABLED=false` and `HOST=127.0.0.1` are the safe defaults. `LAN_ENABLED=true` defaults the bind to `0.0.0.0`; a specific non-wildcard `HOST` must be an IP actually assigned to a local interface.
- Origin checks stay enforced. The hosted client is same-origin, so it needs no `CLIENT_ORIGINS` entry; a Vite dev client on ports 5173–5180 of the same host is also accepted; anything else needs its exact origin in `CLIENT_ORIGINS`. Wildcards are never used.
- Guest bearer tokens stay in HTTP `Authorization` headers and the WebSocket authentication message — never in URLs, query strings, or room snapshots. PostgreSQL stores only token hashes.
- A local PostgreSQL server is required for guests, rooms, and races. With `DATABASE_REQUIRED=true` the API refuses to start when PostgreSQL is unavailable instead of pretending to persist multiplayer.
- `/api/lan-info` exposes only enablement, port, private IPv4 addresses, and whether the client is served. It carries no guest, room, or token data and has no administrative action.
- Manual entry is always available. No broadcast/multicast discovery is implemented, so no addresses or room data are leaked onto the network.
- Plain HTTP is used on the trusted private network. Do not use hotspot mode on untrusted networks; there is no TLS in this mode.

## Manual testing

Automated tests and `node scripts/verify-hotspot.mjs` drive the real server over a local IPv4 address using loopback-routed sockets. They do **not** prove firewall behavior, router/hotspot client isolation, real phone browsers, or layout on other devices. Physical two- and three-device test results must be recorded separately and must not be inferred from automated runs.
