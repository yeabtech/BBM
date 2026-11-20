import {
  BALL_COLORS,
  BALL_SKINS,
  type BallColor,
  type BallSkin,
  type GuestProfile,
  type GameplaySnapshot,
  type RaceSessionSnapshot,
  type RoomSnapshot,
  type ServerMessage,
} from "@bbm/shared-contracts";
import { RoomSocket, apiBaseUrl } from "../networking/room-socket.js";
import {
  checkServerHealth,
  isBbmServer,
  parseServerAddress,
  serverAddressParts,
} from "../networking/server-address.js";
import { countdownLabel } from "../game/presentation/race-presentation.js";
import { setupGameOrientation } from "../game/screen-orientation.js";
import {
  MAX_AUTOMATIC_RECONNECT_ATTEMPTS,
  reconnectDelayMs,
} from "../networking/reconnect-policy.js";
import { BALL_SKIN_OPTIONS } from "../game/rendering/ball-skins.js";

const TOKEN_KEY = "bbm.guest-token.v1";

export function mountLobby(root: HTMLElement): void {
  root.innerHTML = `
    <section class="lobby-shell">
      <header class="lobby-header"><div><p class="eyebrow">BOUNCE BALL MULTIPLAYER</p><h1>Private room lobby</h1></div><a class="solo-link" href="./play.html">Open solo platformer</a></header>
      <div class="connection-line"><p id="connection-status" class="connection-status" role="status">Checking guest session…</p><button id="reconnect" class="secondary" type="button" hidden>Reconnect</button></div>
      <ol class="host-steps" aria-label="Host setup steps">
        <li><strong>Start hosting</strong><span>Press the button below once. This computer then hosts the game for everyone on the same Wi-Fi or hotspot.</span></li>
        <li><strong>Share the code</strong><span>Send the connection link and the room code to the other players.</span></li>
        <li><strong>Play</strong><span>Choose a name, create a room, and press Start Race once everyone is ready.</span></li>
      </ol>
      <p id="lobby-notice" class="lobby-notice" role="status" aria-live="polite"></p>
      <section class="lobby-card" aria-labelledby="host-heading">
        <h2 id="host-heading">Host a game</h2>
        <p id="lan-status" class="small-note" role="status">Checking…</p>
        <div id="lan-addresses" class="lan-addresses" hidden></div>
        <button id="start-hosting" type="button" hidden>Start hosting on this computer</button>
      </section>
      <section class="lobby-card" aria-labelledby="guest-heading">
        <h2 id="guest-heading">Your player</h2>
        <form id="guest-form" class="guest-form">
          <label>Display name <input id="display-name" name="displayName" minlength="2" maxlength="20" autocomplete="nickname" required /></label>
          <fieldset class="ball-skin-picker">
            <legend>Choose your ball</legend>
            ${BALL_SKIN_OPTIONS.map(
              (skin) => `
                <label class="ball-skin-option">
                  <input type="radio" name="ballSkin" value="${skin.value}"${skin.value === "soccer" ? " checked" : ""} required />
                  <img src="/assets/balls/regular/${skin.file}" alt="" />
                  <span>${skin.label}</span>
                </label>`,
            ).join("")}
          </fieldset>
          <button id="guest-submit" type="submit">Create guest</button>
        </form>
      </section>
      <section id="lobby-actions" class="lobby-card" hidden aria-labelledby="rooms-heading">
        <h2 id="rooms-heading">Private rooms</h2>
        <div class="room-actions">
          <button id="create-room" type="button">Create room</button>
          <form id="join-form"><label>Room code <input id="room-code" name="code" inputmode="text" autocomplete="off" maxlength="8" aria-label="Six-character room code" /></label><button id="join-room" type="submit">Join room</button></form>
        </div>
        <p class="small-note">Room codes are private. Share the code with the people you want to invite.</p>
        <details class="advanced">
          <summary>Joining a different computer?</summary>
          <form id="server-form" class="guest-form">
            <label>Host address <input id="server-host" name="host" autocomplete="url" required /></label>
            <label>Server port <input id="server-port" name="port" inputmode="numeric" type="number" min="1" max="65535" required /></label>
            <button id="server-connect" type="submit">Connect to server</button>
          </form>
          <p class="small-note">Use the host's address and port when you are not already on the host's own link. If you opened the host's link, you do not need this.</p>
        </details>
      </section>
      <section id="room-panel" class="lobby-card room-panel" hidden aria-labelledby="room-title">
        <div class="room-heading"><div><p class="eyebrow">YOUR ROOM CODE</p><h2 id="room-title" class="room-code"></h2></div><button id="copy-code" class="secondary" type="button">Copy code</button></div>
        <p id="room-status" class="room-status"></p>
        <p id="room-share-address" class="small-note"></p>

        <ul id="player-list" class="player-list" aria-label="Room players"></ul>
        <p id="ready-summary" class="ready-summary"></p>
        <p id="race-status" class="race-status" role="status" aria-live="polite"></p>
        <div class="room-controls"><button id="ready-toggle" type="button">Ready up</button><button id="start-race" type="button" hidden>Start Race</button><button id="leave-room" class="secondary" type="button">Leave room</button></div>
      </section>
    </section>`;

  const status = required<HTMLElement>(root, "#connection-status");
  const reconnectButton = required<HTMLButtonElement>(root, "#reconnect");
  const notice = required<HTMLElement>(root, "#lobby-notice");
  const lanStatus = required<HTMLElement>(root, "#lan-status");
  const startHostingButton = required<HTMLButtonElement>(
    root,
    "#start-hosting",
  );
  const lanAddresses = required<HTMLElement>(root, "#lan-addresses");
  const serverForm = required<HTMLFormElement>(root, "#server-form");
  const serverHostInput = required<HTMLInputElement>(root, "#server-host");
  const serverPortInput = required<HTMLInputElement>(root, "#server-port");
  const serverConnectButton = required<HTMLButtonElement>(
    root,
    "#server-connect",
  );
  const form = required<HTMLFormElement>(root, "#guest-form");
  const nameInput = required<HTMLInputElement>(root, "#display-name");
  const ballSkinInputs = Array.from(
    root.querySelectorAll<HTMLInputElement>('input[name="ballSkin"]'),
  );
  const guestSubmit = required<HTMLButtonElement>(root, "#guest-submit");
  const actions = required<HTMLElement>(root, "#lobby-actions");
  const roomPanel = required<HTMLElement>(root, "#room-panel");
  const roomTitle = required<HTMLElement>(root, "#room-title");
  const roomStatus = required<HTMLElement>(root, "#room-status");
  const roomShareAddress = required<HTMLElement>(root, "#room-share-address");

  const playerList = required<HTMLUListElement>(root, "#player-list");
  const readySummary = required<HTMLElement>(root, "#ready-summary");
  const readyToggle = required<HTMLButtonElement>(root, "#ready-toggle");

  const startRaceButton = required<HTMLButtonElement>(root, "#start-race");
  const raceStatus = required<HTMLElement>(root, "#race-status");
  const submitRoomCode = required<HTMLInputElement>(root, "#room-code");
  const roomActionButtons = [
    required<HTMLButtonElement>(root, "#create-room"),
    required<HTMLButtonElement>(root, "#join-room"),
  ];
  let activeApiBaseUrl = safeServerStorageGet() ?? apiBaseUrl();
  let currentTokenStorageKey = guestTokenStorageKey(activeApiBaseUrl);
  let guest: GuestProfile | null = null;
  let selectedConnection = false;

  // When this page is served by the BBM API itself (hotspot mode), that server is
  // authoritative: same origin, and no stored address from another session may
  // override it. Otherwise keep the remembered/configured server.
  async function resolveInitialServer(): Promise<void> {
    const served = await servedOrigin();
    if (served) {
      activeApiBaseUrl = served;
      currentTokenStorageKey = guestTokenStorageKey(served);
      selectedConnection = false;
    }
    const initialServer = serverAddressParts(activeApiBaseUrl);
    serverHostInput.value = initialServer.host;
    serverPortInput.value = initialServer.port;
  }
  let currentRoom: RoomSnapshot | null = null;
  let currentRace: RaceSessionSnapshot | null = null;
  let latestGameplaySnapshot: GameplaySnapshot | null = null;
  let raceResultsReceived = false;
  let raceCountdownTimer = 0;
  let raceClockOffsetMs = 0;
  let startRacePending = false;
  let connection: RoomSocket | null = null;
  let connected = false;
  let connectionGeneration = 0;
  let reconnectTimer = 0;
  let reconnectAttempt = 0;
  let multiplayerGame: { destroy(removeCanvas?: boolean): void } | null = null;
  let clearGameOrientation: (() => void) | null = null;
  let multiplayerLoading = false;
  const gameplayListeners = new Set<(message: ServerMessage) => void>();
  const connectionListeners = new Set<(value: boolean) => void>();
  const gameRoot = required<HTMLElement>(document, "#game-root");
  const gameElement = required<HTMLElement>(document, "#game");
  const gameLobbyLink = required<HTMLAnchorElement>(
    document,
    "#game-lobby-link",
  );

  let servedClient = false;

  let prefillToClear: string | null = null;

  /** One primary, copyable address plus any remaining adapters as rows. */
  function renderLanAddresses(
    info: { port: number; clientServed: boolean },
    primary: string,
  ): Node[] {
    const nodes: Node[] = [];
    const label = document.createElement("p");
    label.className = "lan-caption";
    label.textContent = info.clientServed
      ? "Other players connect to the same Wi-Fi or hotspot and open this link:"
      : "Other players on the same Wi-Fi or hotspot connect to this server:";
    nodes.push(label);

    const primaryValue = info.clientServed
      ? `http://${primary}:${info.port}/`
      : `http://${primary}:${info.port}`;
    const primaryRow = document.createElement("div");
    primaryRow.className = "lan-primary";
    const code = document.createElement("code");
    code.textContent = primaryValue;
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "secondary";
    copy.textContent = "Copy link";
    copy.addEventListener("click", async () => {
      try {
        await copyText(primaryValue);
        showNotice("Connection link copied.", "success");
      } catch {
        showNotice(`Copy this link manually: ${primaryValue}`, "error");
      }
    });
    primaryRow.append(code, copy);
    nodes.push(primaryRow);

    if (info.clientServed) {
      const useOwn = document.createElement("button");
      useOwn.type = "button";
      useOwn.className = "secondary use-own-address";
      useOwn.textContent = "Use this computer's address";
      useOwn.addEventListener("click", () => {
        serverHostInput.value = primary;
        serverPortInput.value = String(info.port);
        showNotice(
          "Filled in this computer's address. Press Connect to server to use it.",
          "info",
        );
      });
      nodes.push(useOwn);
    }

    const others = (lanAddresses.dataset.all ?? "")
      .split(",")
      .filter((address) => address && address !== primary);
    if (others.length > 0) {
      const otherLabel = document.createElement("p");
      otherLabel.className = "small-note lan-others";
      otherLabel.textContent =
        "Also detected on this computer (use only if the link above does not work):";
      const otherList = document.createElement("ul");
      otherList.className = "lan-other-list";
      for (const address of others) {
        const item = document.createElement("li");
        const value = document.createElement("code");
        value.textContent = info.clientServed
          ? `http://${address}:${info.port}/`
          : `${address}:${info.port}`;
        item.append(value);
        otherList.append(item);
      }
      nodes.push(otherLabel, otherList);
    }
    return nodes;
  }

  async function refreshLanInfo(): Promise<void> {
    const baseUrl = activeApiBaseUrl;
    const servedByApi = (await servedOrigin()) === baseUrl;
    lanAddresses.dataset.primary = "";
    lanAddresses.dataset.all = "";
    lanAddresses.hidden = true;
    lanAddresses.replaceChildren();
    try {
      const response = await fetch(`${baseUrl}/api/lan-info`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (baseUrl !== activeApiBaseUrl) return;
      if (!response.ok) throw new Error("LAN status is unavailable.");
      const info = await readApiResponse(response, baseUrl);
      if (!isLanInfo(info)) throw new Error("LAN status response was invalid.");
      // Hosting can be started from this page: offer the action when the server
      // accepts it and is still listening on this computer only.
      startHostingButton.hidden = !(
        servedByApi &&
        info.canHost &&
        !info.enabled
      );
      if (!info.enabled) {
        lanStatus.textContent = servedByApi
          ? "Ready to host. Press Start hosting to let other devices on your Wi-Fi or hotspot join."
          : "Waiting for the host to start hosting.";
        lanAddresses.hidden = true;
        return;
      }
      startHostingButton.hidden = true;
      lanStatus.textContent = servedByApi
        ? "You are hosting. Other players can join now."
        : "Connected to the host.";
      servedClient = info.clientServed;
      if (info.addresses.length === 0) {
        lanStatus.textContent =
          "LAN hosting is enabled, but no usable private IPv4 address was found. Check the host network adapter and enter its address manually.";
        return;
      }
      lanAddresses.dataset.primary = info.addresses[0]!;
      lanAddresses.dataset.all = info.addresses.join(",");
      lanAddresses.hidden = false;
      // A hosting computer should never be told to "connect" through loopback,
      // so offer its reachable address when the field still holds a default.
      const ownAddress = info.addresses[0]!;
      if (isLocalOnlyAddress(serverHostInput.value)) {
        serverHostInput.value = ownAddress;
        prefillToClear = ownAddress;
      }
      lanAddresses.hidden = false;
      lanAddresses.replaceChildren(...renderLanAddresses(info, ownAddress));
      if (currentRoom) renderRoom(currentRoom);
    } catch {
      if (baseUrl !== activeApiBaseUrl) return;
      lanStatus.textContent =
        "Could not reach this server to check LAN hosting. Check the host address, port, and network connection.";
      lanAddresses.textContent = "";
    }
  }

  const showNotice = (
    message: string,
    kind: "info" | "error" | "success" = "info",
  ) => {
    notice.textContent = message;
    notice.dataset.kind = kind;
  };
  const setConnected = (value: boolean, message?: string) => {
    connected = value;
    status.textContent =
      message ??
      (value
        ? "Connected to the room service"
        : "Disconnected from the room service");
    status.dataset.connected = String(value);
    actions.hidden = !value || !guest;
    connectionListeners.forEach((listener) => listener(value));
    reconnectButton.hidden = value || !safeStorageGet(currentTokenStorageKey);
    roomActionButtons.forEach((button) => {
      button.disabled = !value;
    });
  };

  const renderRoom = (room: RoomSnapshot | null) => {
    if (!room) {
      currentRoom = null;
      roomPanel.hidden = true;
      actions.hidden = !connected;
      return;
    }
    if (
      currentRoom &&
      room.roomId === currentRoom.roomId &&
      room.revision < currentRoom.revision
    )
      return;
    currentRoom = room;
    roomPanel.hidden = false;
    actions.hidden = true;
    roomTitle.textContent = room.code;
    const localClientPort =
      window.location.port ||
      (window.location.protocol === "https:" ? "443" : "80");
    const hostIp = lanAddresses.dataset.primary;
    roomShareAddress.textContent = hostIp
      ? servedClient
        ? `Players on your Wi-Fi/hotspot who open the link above can join with this room code.`
        : `Players can open ${window.location.protocol}//${hostIp}:${localClientPort} and connect to ${hostIp}:${serverPortInput.value}.`
      : "Share your LAN client address and server address with players on the same network.";
    roomStatus.textContent =
      room.status === "open"
        ? `${room.players.length} of ${room.maxPlayers} player slots used`
        : "This room is closed.";
    playerList.replaceChildren(
      ...room.players.map((player) => {
        const item = document.createElement("li");
        item.className = "player-slot";
        const swatch = document.createElement("span");
        swatch.className = `color-swatch color-${player.color}`;
        swatch.setAttribute("aria-hidden", "true");
        const details = document.createElement("span");
        details.className = "player-details";
        const name = document.createElement("strong");
        name.textContent = `${player.displayName}${player.host ? " · Host" : ""}${player.guestId === guest?.id ? " · You" : ""}`;
        const state = document.createElement("small");
        state.textContent = `${player.connected ? "Connected" : "Disconnected"} · ${player.ready ? "Ready" : "Not ready"}`;
        details.append(name, state);
        const badge = document.createElement("span");
        badge.className =
          player.ready && player.connected
            ? "ready-badge is-ready"
            : "ready-badge";
        badge.textContent =
          player.ready && player.connected ? "READY" : "WAITING";
        item.append(swatch, details, badge);
        return item;
      }),
    );
    const connectedPlayers = room.players.filter((player) => player.connected);
    const readyCount = connectedPlayers.filter((player) => player.ready).length;
    readySummary.textContent = room.canPrepareToStart
      ? "Everyone is ready. The host can start the race."
      : `${readyCount}/${connectedPlayers.length} connected players ready · at least ${room.minPlayers} connected players required`;
    const self = room.players.find((player) => player.guestId === guest?.id);
    readyToggle.textContent = self?.ready ? "Set not ready" : "Ready up";
    readyToggle.disabled =
      !connected || !self?.connected || room.status !== "open";
    const isHost = room.hostGuestId === guest?.id;

    startRaceButton.hidden = !isHost;
    startRaceButton.disabled =
      !connected ||
      startRacePending ||
      !room.canPrepareToStart ||
      currentRace?.state === "Countdown" ||
      currentRace?.state === "InProgress";
    if (!currentRace)
      raceStatus.textContent = room.canPrepareToStart
        ? "Waiting for the host to start a race."
        : "Start is unavailable until at least two players are connected and everyone connected is ready.";
    roomPanel.classList.toggle("is-closed", room.status !== "open");
  };

  const renderRace = (race: RaceSessionSnapshot | null) => {
    if (
      race &&
      currentRace &&
      ((race.raceId === currentRace.raceId &&
        race.revision < currentRace.revision) ||
        (race.raceId !== currentRace.raceId &&
          Date.parse(race.createdAt) < Date.parse(currentRace.createdAt)))
    )
      return;
    currentRace = race;
    if (raceCountdownTimer) {
      window.clearInterval(raceCountdownTimer);
      raceCountdownTimer = 0;
    }
    raceClockOffsetMs = race ? Date.parse(race.serverNow) - Date.now() : 0;
    if (!race) {
      raceStatus.textContent = currentRoom?.canPrepareToStart
        ? "Waiting for the host to start a race."
        : "Start is unavailable until at least two players are connected and everyone connected is ready.";
    } else if (race.state === "Countdown" && race.countdownDeadlineAt) {
      const updateCountdown = () => {
        const remaining = Math.max(
          0,
          Date.parse(race.countdownDeadlineAt!) -
            (Date.now() + raceClockOffsetMs),
        );
        const label = countdownLabel(
          race.countdownDeadlineAt!,
          raceClockOffsetMs,
          Date.now(),
        );
        const count = label === "GO!" ? 0 : Number(label);
        const previous = raceStatus.dataset.countdown;
        raceStatus.dataset.countdown = String(count);
        raceStatus.classList.add("is-counting-down");
        raceStatus.textContent = label;
        if (previous !== String(count)) {
          raceStatus.classList.remove("countdown-pop");
          void raceStatus.offsetWidth;
          raceStatus.classList.add("countdown-pop");
        }
        raceStatus.classList.toggle("countdown-go", remaining <= 0);
      };
      updateCountdown();
      raceCountdownTimer = window.setInterval(updateCountdown, 100);
    } else if (race.state === "InProgress") {
      raceStatus.classList.remove(
        "is-counting-down",
        "countdown-pop",
        "countdown-go",
      );
      raceStatus.dataset.countdown = "";
      const startedAt = race.officialStartAt
        ? new Date(race.officialStartAt).toLocaleTimeString()
        : "now";
      raceStatus.textContent = `Race in progress. Official start: ${startedAt}.`;
    } else if (race.state === "Cancelled") {
      const messages = {
        Timeout: "The race was cancelled because its time limit expired.",
        HostLeft: "The race was cancelled because the host left the room.",
        RoomExpired: "The race was cancelled because the room expired.",
        ServerRestart: "The race was cancelled because the server restarted.",
      };
      raceStatus.textContent = messages[race.cancellationReason ?? "Timeout"];
    } else if (race.state === "Finished") {
      raceStatus.textContent = "Race finished.";
    } else {
      raceStatus.textContent = "Waiting for the host to start a race.";
    }
    if (currentRoom) renderRoom(currentRoom);
  };

  const onServerMessage = (message: ServerMessage) => {
    gameplayListeners.forEach((listener) => listener(message));
    switch (message.type) {
      case "authenticated":
        reconnectAttempt = 0;
        guest = message.payload.guest;
        nameInput.value = guest.displayName;
        setBallSkin(guest.ballSkin);
        guestSubmit.textContent = "Save guest preferences";
        setConnected(true);
        renderRoom(message.payload.room);
        renderRace(message.payload.race);
        if (
          message.payload.race?.state === "InProgress" &&
          message.payload.room
        )
          void enterMultiplayerGame();
        if (message.payload.race?.state === "Cancelled") exitMultiplayerGame();
        showNotice("Guest session connected.", "success");
        break;
      case "room_created":
      case "room_joined":
      case "room_snapshot_updated":
        renderRoom(message.payload.room);
        break;
      case "room_closed":
        if (currentRoom?.roomId === message.payload.roomId) {
          exitMultiplayerGame();
          renderRace(null);
          renderRoom(null);
        }
        showNotice(
          message.payload.reason === "host_left"
            ? "The host closed this room."
            : "This room is no longer active.",
        );
        break;
      case "player_left":
        if (message.payload.guestId === guest?.id) {
          renderRace(null);
          renderRoom(null);
        }
        break;
      case "ready_to_start_result":
        showNotice(message.payload.message, "success");
        break;
      case "race_snapshot":
      case "race_countdown_started":
      case "race_started":
      case "race_cancelled":
      case "race_state_changed":
        if (message.type === "race_countdown_started")
          raceResultsReceived = false;
        renderRace(message.payload.race);
        if (message.payload.race?.state === "InProgress")
          void enterMultiplayerGame();
        if (message.payload.race?.state === "Cancelled" && !raceResultsReceived)
          exitMultiplayerGame();
        if (message.type === "race_cancelled")
          showNotice("The race was cancelled.", "error");
        break;
      case "gameplay_snapshot":
        latestGameplaySnapshot = message.payload;
        if (currentRace?.state === "InProgress") void enterMultiplayerGame();
        break;
      case "race_results":
        raceResultsReceived = true;
        showNotice(
          `Race results: ${message.payload.results.map((result) => `${result.place ? `#${result.place} ` : ""}${result.displayName} (${result.status})`).join(" · ")}`,
          "success",
        );
        break;
      case "protocol_error":
        showNotice(message.payload.message, "error");
        if (message.payload.code === "INVALID_TOKEN")
          safeStorageRemove(currentTokenStorageKey);
        break;
      default:
        break;
    }
  };

  function scheduleReconnect(generation: number, sessionToken: string): void {
    if (reconnectTimer || generation !== connectionGeneration) return;
    if (safeStorageGet(currentTokenStorageKey) !== sessionToken) return;
    if (reconnectAttempt >= MAX_AUTOMATIC_RECONNECT_ATTEMPTS) {
      setConnected(
        false,
        "Automatic reconnect paused. Select Reconnect to retry.",
      );
      return;
    }
    const delay = reconnectDelayMs(reconnectAttempt);
    reconnectAttempt += 1;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = 0;
      if (generation === connectionGeneration) void connectGuest(sessionToken);
    }, delay);
  }

  async function connectGuest(sessionToken: string): Promise<void> {
    const generation = ++connectionGeneration;
    if (reconnectTimer) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = 0;
    }
    connection?.close();
    const socket = new RoomSocket(activeApiBaseUrl);
    connection = socket;
    socket.onMessage(onServerMessage);
    socket.onStatus((value) => {
      if (generation !== connectionGeneration) return;
      setConnected(
        value,
        value
          ? "Connected to the room service"
          : "Reconnecting to the room service…",
      );
      if (!value) scheduleReconnect(generation, sessionToken);
    });
    setConnected(false, "Connecting to the room service…");
    try {
      const authenticated = await socket.connect(sessionToken);
      if (authenticated.type !== "authenticated")
        throw new Error("Guest authentication failed.");
      if (generation !== connectionGeneration) return;
    } catch (error) {
      if (generation !== connectionGeneration) return;
      socket.close();
      setConnected(false, "Disconnected from the room service");
      showNotice(errorText(error), "error");
      scheduleReconnect(generation, sessionToken);
    }
  }

  async function enterMultiplayerGame(): Promise<void> {
    if (
      multiplayerGame ||
      multiplayerLoading ||
      !guest ||
      !currentRoom ||
      currentRace?.state !== "InProgress"
    )
      return;
    multiplayerLoading = true;
    try {
      const { createMultiplayerGame } =
        await import("../game/create-multiplayer-game.js");
      if (
        !guest ||
        !currentRoom ||
        currentRace?.state !== "InProgress" ||
        multiplayerGame
      )
        return;
      root.hidden = true;
      gameRoot.hidden = false;
      clearGameOrientation = setupGameOrientation(gameRoot);
      multiplayerGame = createMultiplayerGame(gameElement, {
        guestId: guest.id,
        room: currentRoom,
        race: currentRace,
        initialSnapshot: latestGameplaySnapshot,
        sendInput: (input) => connection?.sendMovementInput(input) ?? false,
        sendPowerUp: (raceId, slot) =>
          connection?.sendPowerUp(raceId, slot) ?? false,
        returnToLobby: () => exitMultiplayerGame(),
        connected: () => connected,
        subscribeMessages: (listener) => {
          gameplayListeners.add(listener);
          return () => gameplayListeners.delete(listener);
        },
        subscribeConnection: (listener) => {
          connectionListeners.add(listener);
          return () => connectionListeners.delete(listener);
        },
      });
    } catch (error) {
      showNotice(errorText(error), "error");
    } finally {
      multiplayerLoading = false;
    }
  }

  function exitMultiplayerGame(): void {
    if (!multiplayerGame) return;
    multiplayerGame.destroy(true);
    multiplayerGame = null;
    clearGameOrientation?.();
    clearGameOrientation = null;
    gameRoot.hidden = true;
    root.hidden = false;
  }

  gameLobbyLink.addEventListener("click", async (event) => {
    if (!multiplayerGame) return;
    event.preventDefault();
    if (connection && connected) {
      try {
        await connection.request("leave_room", {});
      } catch {
        // Returning to the lobby remains available while the connection recovers.
      }
    }
    exitMultiplayerGame();
  });

  async function runRequest<T extends Parameters<RoomSocket["request"]>[0]>(
    button: HTMLButtonElement,
    type: T,
    payload: Parameters<RoomSocket["request"]>[1],
  ): Promise<ServerMessage | null> {
    if (!connection || !connected) {
      showNotice("Connect to the room service first.", "error");
      return null;
    }
    button.disabled = true;
    try {
      return await connection.request(type, payload as never);
    } catch (error) {
      showNotice(errorText(error), "error");
      return null;
    } finally {
      button.disabled = false;
      if (type === "create_room" || type === "join_room")
        button.disabled = !connected;
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    // A page served by Vite or any static host is not the BBM API. Sending a
    // request to a guessed `:3000` on the same hostname is fragile (the server
    // may use another port, or may not host the client at all), so require an
    // explicit server selection first instead of failing with a bare 404.
    if (
      !(await servedOrigin()) &&
      !selectedConnection &&
      isDevServerPage() &&
      !(await isBbmServer(activeApiBaseUrl))
    ) {
      showNotice(
        "This page was not served by the BBM game server. Enter the host computer's address and port above, press Connect to server, then create your guest.",
        "error",
      );
      setConnected(
        false,
        "Not connected to a BBM server. Enter the host address above.",
      );
      return;
    }
    guestSubmit.disabled = true;
    try {
      const existingToken = safeStorageGet(currentTokenStorageKey);
      const response = await fetch(
        `${activeApiBaseUrl}/api/guests${existingToken ? "/me" : ""}`,
        {
          method: existingToken ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
            ...(existingToken
              ? { Authorization: `Bearer ${existingToken}` }
              : {}),
          },
          body: JSON.stringify({
            displayName: nameInput.value,
            ballSkin: selectedBallSkin(),
          }),
        },
      );
      const data = await readApiResponse(response, activeApiBaseUrl);
      if (!existingToken) {
        if (!isGuestCreateResponse(data))
          throw new Error("The server returned an invalid guest session.");
        safeStorageSet(data.token, currentTokenStorageKey);
        guest = data.guest;
        showNotice("Guest created. Connecting…", "success");
        await connectGuest(data.token);
      } else {
        if (!isGuestProfile(data))
          throw new Error("The server returned an invalid guest profile.");
        guest = data;
        showNotice("Guest preferences saved.", "success");
      }
    } catch (error) {
      showNotice(errorText(error), "error");
    } finally {
      guestSubmit.disabled = false;
    }
  });

  serverHostInput.addEventListener("focus", () => {
    // Clear a loopback placeholder so typing replaces it instead of appending.
    if (
      prefillToClear &&
      serverHostInput.value.trim() === prefillToClear &&
      isLocalOnlyAddress(prefillToClear)
    )
      serverHostInput.value = "";
  });

  serverForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (currentRoom) {
      showNotice("Leave your current room before changing servers.", "error");
      return;
    }
    let nextBaseUrl: string;
    try {
      nextBaseUrl = parseServerAddress(
        serverHostInput.value,
        serverPortInput.value,
      );
    } catch (error) {
      showNotice(errorText(error), "error");
      return;
    }
    serverConnectButton.disabled = true;
    try {
      await checkServerHealth(nextBaseUrl);
      const nextTokenStorageKey = guestTokenStorageKey(nextBaseUrl);
      const savedToken = safeStorageGet(nextTokenStorageKey);
      let profile: GuestProfile | null = null;
      if (savedToken) {
        const profileResponse = await fetch(`${nextBaseUrl}/api/guests/me`, {
          headers: { Authorization: `Bearer ${savedToken}` },
          signal: AbortSignal.timeout(5_000),
        });
        // A saved token that this server no longer knows about is simply dropped.
        const data = await readApiResponse(profileResponse, nextBaseUrl).catch(
          () => null,
        );
        if (profileResponse.ok && isGuestProfile(data)) profile = data;
        else safeStorageRemove(nextTokenStorageKey);
      }
      connection?.close();
      connection = null;
      guest = profile;
      currentRoom = null;
      currentRace = null;
      activeApiBaseUrl = nextBaseUrl;
      currentTokenStorageKey = nextTokenStorageKey;
      selectedConnection = true;
      safeServerStorageSet(nextBaseUrl);
      await refreshLanInfo();
      if (profile && savedToken) {
        nameInput.value = profile.displayName;
        setBallSkin(profile.ballSkin);
        await connectGuest(savedToken);
        showNotice("Connected to the selected LAN server.", "success");
      } else {
        setConnected(false, "Create a guest session for this server.");
        showNotice(
          "Server reached. Create a guest identity to join.",
          "success",
        );
      }
    } catch (error) {
      showNotice(errorText(error), "error");
    } finally {
      serverConnectButton.disabled = false;
    }
  });

  required<HTMLFormElement>(root, "#join-form").addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();
      await runRequest(roomActionButtons[1]!, "join_room", {
        code: submitRoomCode.value,
      });
    },
  );
  roomActionButtons[0]!.addEventListener("click", async () => {
    await runRequest(roomActionButtons[0]!, "create_room", {});
  });
  readyToggle.addEventListener("click", async () => {
    const self = currentRoom?.players.find(
      (player) => player.guestId === guest?.id,
    );
    if (self)
      await runRequest(readyToggle, "set_ready", { ready: !self.ready });
  });

  startRaceButton.addEventListener("click", async () => {
    if (!connection || !connected || startRacePending) return;
    startRacePending = true;
    if (currentRoom) renderRoom(currentRoom);
    try {
      const response = await connection.request("start_race", {});
      if (response.type === "protocol_error")
        showNotice(response.payload.message, "error");
    } catch (error) {
      showNotice(errorText(error), "error");
    } finally {
      startRacePending = false;
      if (currentRoom) renderRoom(currentRoom);
    }
  });
  required<HTMLButtonElement>(root, "#leave-room").addEventListener(
    "click",
    async (event) => {
      await runRequest(
        event.currentTarget as HTMLButtonElement,
        "leave_room",
        {},
      );
    },
  );
  required<HTMLButtonElement>(root, "#copy-code").addEventListener(
    "click",
    async () => {
      if (!currentRoom) return;
      try {
        await copyText(currentRoom.code);
        showNotice("Room code copied.", "success");
      } catch {
        showNotice(`Share room code ${currentRoom.code} with your guests.`);
      }
    },
  );
  startHostingButton.addEventListener("click", async () => {
    startHostingButton.disabled = true;
    startHostingButton.textContent = "Starting hosting…";
    const baseUrl = activeApiBaseUrl;
    try {
      const response = await fetch(`${baseUrl}/api/hosting`, {
        method: "POST",
      });
      const result = await readApiResponse(response, baseUrl);
      if (!isHostingResult(result) || !result.enabled)
        throw new Error(
          "Hosting did not start. Check Windows Firewall and try again.",
        );
      showNotice(
        "Hosting started. Create your player below, then share the room code.",
        "success",
      );
      // The server rebinds its listener, so reconnect to the same address.
      const token = safeStorageGet(currentTokenStorageKey);
      if (token) await connectGuest(token);
    } catch (error) {
      showNotice(errorText(error), "error");
    } finally {
      startHostingButton.disabled = false;
      startHostingButton.textContent = "Start hosting on this computer";
      await refreshLanInfo();
    }
  });

  reconnectButton.addEventListener("click", () => {
    const savedToken = safeStorageGet(currentTokenStorageKey);
    if (savedToken) {
      reconnectAttempt = 0;
      void connectGuest(savedToken);
    }
  });

  // Resolve the serving origin before any request: LAN status and the guest
  // session are requested immediately below, and a remembered address from an
  // earlier session would send them to the wrong server.
  void (async () => {
    const served = await servedOrigin();
    if (served) {
      activeApiBaseUrl = served;
      currentTokenStorageKey = guestTokenStorageKey(served);
    }
    await start();
    void refreshLanInfo();
  })();

  async function start(): Promise<void> {
    await resolveInitialServer();
    const token = safeStorageGet(currentTokenStorageKey);
    if (!token) {
      setConnected(false, "Create a guest session to use private rooms.");
      return;
    }
    try {
      const response = await fetch(`${activeApiBaseUrl}/api/guests/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const profile = await readApiResponse(response, activeApiBaseUrl);
      if (!isGuestProfile(profile))
        throw new Error("The server returned an invalid guest profile.");
      guest = profile;
      nameInput.value = profile.displayName;
      setBallSkin(profile.ballSkin);
      guestSubmit.textContent = "Save guest preferences";
      await connectGuest(token);
    } catch (error) {
      safeStorageRemove(currentTokenStorageKey);
      setConnected(false, "Create a guest session to use private rooms.");
      showNotice(errorText(error), "error");
    }
  }

  function isGuestProfile(value: unknown): value is GuestProfile {
    if (typeof value !== "object" || value === null) return false;
    const profile = value as Record<string, unknown>;
    return (
      typeof profile.id === "string" &&
      typeof profile.displayName === "string" &&
      typeof profile.color === "string" &&
      BALL_COLORS.includes(profile.color as BallColor) &&
      typeof profile.ballSkin === "string" &&
      BALL_SKINS.includes(profile.ballSkin as BallSkin)
    );
  }
  function isGuestCreateResponse(
    value: unknown,
  ): value is { guest: GuestProfile; token: string } {
    if (typeof value !== "object" || value === null) return false;
    const response = value as Record<string, unknown>;
    return isGuestProfile(response.guest) && typeof response.token === "string";
  }

  function selectedBallSkin(): BallSkin {
    const selected = ballSkinInputs.find((input) => input.checked)?.value;
    if (!selected || !BALL_SKINS.includes(selected as BallSkin))
      throw new Error("Choose one of the available ball styles.");
    return selected as BallSkin;
  }

  function setBallSkin(skin: BallSkin): void {
    const input = ballSkinInputs.find((candidate) => candidate.value === skin);
    if (!input) throw new Error("The saved ball style is not available.");
    input.checked = true;
  }
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing lobby element: ${selector}`);
  return element;
}
function safeStorageGet(key: string): string | null {
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const legacy = localStorage.getItem(TOKEN_KEY);
    if (legacy) {
      localStorage.setItem(key, legacy);
      localStorage.removeItem(TOKEN_KEY);
    }
    return legacy;
  } catch {
    return null;
  }
}
function safeStorageSet(token: string, key: string): void {
  try {
    localStorage.setItem(key, token);
  } catch {
    throw new Error(
      "Browser storage is unavailable. Enable local storage to keep this guest session.",
    );
  }
}
function safeStorageRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* storage may be disabled */
  }
}
function guestTokenStorageKey(baseUrl: string): string {
  return `${TOKEN_KEY}:${new URL(baseUrl).origin}`;
}
async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall back for insecure LAN HTTP origins and restricted clipboard permissions.
    }
  }
  const field = document.createElement("textarea");
  field.value = value;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("Copy is unavailable in this browser.");
}
function safeServerStorageGet(): string | null {
  try {
    const saved = localStorage.getItem("bbm.server-address.v1");
    if (!saved) return null;
    const parsed = new URL(saved);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}
function safeServerStorageSet(baseUrl: string): void {
  try {
    localStorage.setItem("bbm.server-address.v1", baseUrl);
  } catch {
    /* Server selection can remain in memory when browser storage is unavailable. */
  }
}
function isLanInfo(value: unknown): value is {
  enabled: boolean;
  port: number;
  addresses: string[];
  clientServed: boolean;
  canHost: boolean;
} {
  if (typeof value !== "object" || value === null) return false;
  const info = value as Record<string, unknown>;
  return (
    typeof info.enabled === "boolean" &&
    typeof info.port === "number" &&
    Number.isInteger(info.port) &&
    Array.isArray(info.addresses) &&
    info.addresses.every((address) => typeof address === "string") &&
    typeof info.clientServed === "boolean" &&
    typeof info.canHost === "boolean"
  );
}
function isHostingResult(value: unknown): value is { enabled: boolean } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).enabled === "boolean"
  );
}
function responseError(value: unknown): string {
  if (typeof value === "object" && value !== null && "error" in value) {
    const error = value.error;
    if (
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      typeof error.message === "string"
    )
      return error.message;
  }
  return "The request could not be completed.";
}
const DEV_PORTS = [5173, 5174, 5175, 5176, 5177, 5178, 5179, 5180];

/**
 * Parses an API response and never throws a bare JSON error.
 *
 * A missing BBM server, an aborted request, a proxy failure, or a static host
 * answering an unknown path can all produce an empty (or HTML) body, so those
 * cases are reported as what they are instead of "Unexpected end of JSON input".
 */
async function readApiResponse(
  response: Response,
  baseUrl: string,
): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) {
    if (text.trim() === "") {
      const hint = DEV_PORTS.includes(Number(new URL(baseUrl).port))
        ? " This page was opened from the Vite development server, which does not run the BBM game server. Open the host computer's BBM address instead, or enter its host and port above and press Connect to server."
        : " The server at this address did not send a response for this route.";
      throw new Error(
        `The BBM server answered ${response.status} without a response body.${hint}`,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(
        `The BBM server answered ${response.status} with an unreadable response. Check the host address and that the game server is running.`,
      );
    }
    throw new Error(responseError(parsed));
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      "The BBM server sent an unreadable response. Reload the page and try again.",
    );
  }
}

/**
 * Origin of the BBM API when it also served this page, otherwise null.
 *
 * The Vite dev server answers any path, so `/api/lan-info` returning JSON is the
 * only reliable signal that this page came from the API (hotspot mode) rather
 * than from Vite or any other static host.
 */
async function servedOrigin(): Promise<string | null> {
  if (window.location.protocol === "https:") return window.location.origin;
  try {
    const response = await fetch("/api/lan-info", {
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) return null;
    const body = await readApiResponse(response, window.location.origin).catch(
      () => null,
    );
    return isLanInfo(body) ? window.location.origin : null;
  } catch {
    return null;
  }
}

function isDevServerPage(): boolean {
  return DEV_PORTS.includes(Number(window.location.port));
}

function isLocalOnlyAddress(host: string): boolean {
  return ["", "127.0.0.1", "localhost", "::1", "0.0.0.0"].includes(
    host.trim().toLowerCase(),
  );
}
function errorText(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The request could not be completed.";
}
