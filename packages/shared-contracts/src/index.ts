export interface HealthResponse {
  status: "ok" | "unavailable";
  service: "bbm-api" | "postgres";
}

export const PROTOCOL_VERSION = 3 as const;
export const BALL_SKINS = [
  "soccer",
  "basketball",
  "volleyball",
  "beach",
] as const;
export type BallSkin = (typeof BALL_SKINS)[number];
export const BALL_COLORS = [
  "mint",
  "coral",
  "sun",
  "sky",
  "violet",
  "blue",
] as const;
export type BallColor = (typeof BALL_COLORS)[number];

export interface GuestProfile {
  id: string;
  displayName: string;
  color: BallColor;
  ballSkin: BallSkin;
}

export interface RoomPlayer {
  guestId: string;
  displayName: string;
  color: BallColor;
  ballSkin: BallSkin;
  host: boolean;
  connected: boolean;
  ready: boolean;
}

export interface RoomSnapshot {
  roomId: string;
  revision: number;
  code: string;
  status: "open" | "closed" | "expired";
  hostGuestId: string;
  players: RoomPlayer[];
  minPlayers: 2;
  maxPlayers: 3;
  canPrepareToStart: boolean;
  expiresAt: string;
}

export type RaceState =
  "Waiting" | "Countdown" | "InProgress" | "Finished" | "Cancelled";
export type RaceCancellationReason =
  "Timeout" | "HostLeft" | "RoomExpired" | "ServerRestart";
export interface RaceSessionSnapshot {
  raceId: string;
  roomId: string;
  revision: number;
  state: RaceState;
  countdownStartedAt: string | null;
  countdownDeadlineAt: string | null;
  officialStartAt: string | null;
  timeoutDeadlineAt: string | null;
  cancellationReason: RaceCancellationReason | null;
  cancelledAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  serverNow: string;
}

export interface GameplayPlayerSnapshot {
  guestId: string;
  raceId: string;
  displayName: string;
  color: BallColor;
  ballSkin: BallSkin;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  grounded: boolean;
  jumpsUsed: number;
  jumpHeld: boolean;
  lastProcessedInputSequence: number;
  connected: boolean;
  simulationTick: number;
  updatedAt: string;
  radius: number;
  mass: number;
  ghost: boolean;
  respawning: boolean;
  respawnAt: string | null;
  inventory: PowerUpType[];
  activeEffects: ActivePowerUp[];
  finished: boolean;
  finishPlace: number | null;
  finishedAt: string | null;
}

export const POWER_UP_TYPES = [
  "speed",
  "jump",
  "heavy",
  "shockwave",
  "shrink",
  "ghost",
] as const;
export type PowerUpType = (typeof POWER_UP_TYPES)[number];
export interface ActivePowerUp {
  type: PowerUpType;
  expiresAt: string;
}
export interface CheckpointSnapshot {
  id: string;
  x: number;
  y: number;
  activated: boolean;
}
export interface PickupSnapshot {
  id: string;
  type: PowerUpType;
  x: number;
  y: number;
  available: boolean;
  availableAt: string | null;
}
export interface RaceResultEntry {
  guestId: string;
  displayName: string;
  color: BallColor;
  place: number | null;
  finishTimeMs: number | null;
  status: "finished" | "unfinished" | "disconnected";
}

export interface GameplaySnapshot {
  protocolVersion: 3;
  raceId: string;
  roomId: string;
  snapshotSequence: number;
  simulationTick: number;
  serverTimestamp: string;
  world: { width: 2400; height: 900; revision: "bbm-physics-v3" };
  players: GameplayPlayerSnapshot[];
  checkpointId: string | null;
  checkpoints: CheckpointSnapshot[];
  pickups: PickupSnapshot[];
  environment: {
    movingPlatforms: Array<{
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }>;
    fallingBlocks: Array<{
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
      state: "idle" | "falling" | "resetting";
    }>;
    crushingTraps: Array<{
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }>;
  };
  results: RaceResultEntry[] | null;
  diagnostics: {
    simulationTickRate: number;
    snapshotRate: number;
    connectedPlayers: number;
    activeSimulations: number;
    inputQueueSize: number;
    snapshotQueueSize: number;
    droppedInputs: number;
    rejectedInputs: number;
    droppedSimulationTicks: number;
    collisionIterations: number;
    collisionResolutionMs: number;
    activePowerUps: number;
    respawningPlayers: number;
    availablePickups: number;
    finishedPlayers: number;
    snapshotBytes: number;
    rejectedCommands: number;
  };
}

export type ClientMessage =
  | {
      version: typeof PROTOCOL_VERSION;
      requestId: string;
      type: "authenticate";
      payload: { token: string };
    }
  | {
      version: typeof PROTOCOL_VERSION;
      requestId: string;
      type: "create_room";
      payload: Record<string, never>;
    }
  | {
      version: typeof PROTOCOL_VERSION;
      requestId: string;
      type: "join_room";
      payload: { code: string };
    }
  | {
      version: typeof PROTOCOL_VERSION;
      requestId: string;
      type: "leave_room";
      payload: Record<string, never>;
    }
  | {
      version: typeof PROTOCOL_VERSION;
      requestId: string;
      type: "set_ready";
      payload: { ready: boolean };
    }
  | {
      version: typeof PROTOCOL_VERSION;
      requestId: string;
      type: "prepare_to_start";
      payload: Record<string, never>;
    }
  | {
      version: typeof PROTOCOL_VERSION;
      requestId: string;
      type: "get_snapshot";
      payload: Record<string, never>;
    }
  | {
      version: typeof PROTOCOL_VERSION;
      requestId: string;
      type: "start_race";
      payload: Record<string, never>;
    }
  | {
      version: typeof PROTOCOL_VERSION;
      requestId: string;
      type: "get_race_snapshot";
      payload: Record<string, never>;
    }
  | {
      version: typeof PROTOCOL_VERSION;
      requestId: string;
      type: "move_input";
      payload: {
        raceId: string;
        sequence: number;
        horizontal: -1 | 0 | 1;
        jumpDown: boolean;
      };
    }
  | {
      version: typeof PROTOCOL_VERSION;
      requestId: string;
      type: "activate_power_up";
      payload: { raceId: string; slot: 0 | 1 };
    };

export type ProtocolErrorCode =
  | "MALFORMED_MESSAGE"
  | "UNSUPPORTED_VERSION"
  | "UNAUTHENTICATED"
  | "INVALID_TOKEN"
  | "INVALID_NAME"
  | "INVALID_COLOR"
  | "INVALID_BALL_SKIN"
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "ROOM_CLOSED"
  | "ROOM_RACE_ACTIVE"
  | "ALREADY_IN_ROOM"
  | "NOT_IN_ROOM"
  | "NOT_HOST"
  | "NOT_READY"
  | "NOT_IN_RACE"
  | "INVALID_INPUT"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export type ServerMessage =
  | {
      version: typeof PROTOCOL_VERSION;
      requestId: string | null;
      type: "authenticated";
      payload: {
        guest: GuestProfile;
        room: RoomSnapshot | null;
        race: RaceSessionSnapshot | null;
      };
    }
  | {
      version: typeof PROTOCOL_VERSION;
      requestId: string | null;
      type: "authentication_result";
      payload: { ok: boolean; guest?: GuestProfile };
    }
  | {
      version: typeof PROTOCOL_VERSION;
      requestId: string | null;
      type: "room_created" | "room_joined" | "room_snapshot_updated";
      payload: { room: RoomSnapshot };
    }
  | {
      version: typeof PROTOCOL_VERSION;
      requestId: string | null;
      type: "player_joined";
      payload: { player: RoomPlayer };
    }
  | {
      version: typeof PROTOCOL_VERSION;
      requestId: string | null;
      type: "player_left";
      payload: { guestId: string };
    }
  | {
      version: typeof PROTOCOL_VERSION;
      requestId: string | null;
      type: "player_connection_status_changed";
      payload: { guestId: string; connected: boolean };
    }
  | {
      version: typeof PROTOCOL_VERSION;
      requestId: string | null;
      type: "ready_status_changed";
      payload: { guestId: string; ready: boolean };
    }
  | {
      version: typeof PROTOCOL_VERSION;
      requestId: string | null;
      type: "room_closed";
      payload: {
        roomId: string;
        reason: "host_left" | "expired" | "empty" | "host_timeout";
      };
    }
  | {
      version: typeof PROTOCOL_VERSION;
      requestId: string | null;
      type: "ready_to_start_result";
      payload: { eligible: boolean; message: string };
    }
  | {
      version: typeof PROTOCOL_VERSION;
      requestId: string | null;
      type:
        | "race_countdown_started"
        | "race_started"
        | "race_cancelled"
        | "race_state_changed";
      payload: { race: RaceSessionSnapshot };
    }
  | {
      version: typeof PROTOCOL_VERSION;
      requestId: string | null;
      type: "race_snapshot";
      payload: { race: RaceSessionSnapshot | null };
    }
  | {
      version: typeof PROTOCOL_VERSION;
      requestId: string | null;
      type: "gameplay_snapshot";
      payload: GameplaySnapshot;
    }
  | {
      version: typeof PROTOCOL_VERSION;
      requestId: string | null;
      type: "race_results";
      payload: {
        raceId: string;
        durationMs: number;
        results: RaceResultEntry[];
      };
    }
  | {
      version: typeof PROTOCOL_VERSION;
      requestId: string | null;
      type: "protocol_error";
      payload: { code: ProtocolErrorCode; message: string };
    };

const clientShapes: Record<ClientMessage["type"], readonly string[]> = {
  authenticate: ["token"],
  create_room: [],
  join_room: ["code"],
  leave_room: [],
  set_ready: ["ready"],
  prepare_to_start: [],
  get_snapshot: [],
  start_race: [],
  get_race_snapshot: [],
  move_input: ["raceId", "sequence", "horizontal", "jumpDown"],
  activate_power_up: ["raceId", "slot"],
};

export function parseClientMessage(value: unknown): ClientMessage | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["version", "requestId", "type", "payload"])
  )
    return null;
  if (
    value.version !== PROTOCOL_VERSION ||
    typeof value.requestId !== "string" ||
    value.requestId.length > 80
  )
    return null;
  if (
    typeof value.type !== "string" ||
    !Object.hasOwn(clientShapes, value.type) ||
    !isRecord(value.payload)
  )
    return null;
  const type = value.type as ClientMessage["type"];
  if (!hasExactKeys(value.payload, clientShapes[type])) return null;
  switch (type) {
    case "authenticate":
      return typeof value.payload.token === "string" &&
        value.payload.token.length >= 32 &&
        value.payload.token.length <= 128
        ? {
            version: PROTOCOL_VERSION,
            requestId: value.requestId,
            type,
            payload: { token: value.payload.token },
          }
        : null;
    case "create_room":
      return {
        version: PROTOCOL_VERSION,
        requestId: value.requestId,
        type,
        payload: {},
      };
    case "join_room":
      return typeof value.payload.code === "string" &&
        /^[A-Z0-9\s-]{1,12}$/i.test(value.payload.code)
        ? {
            version: PROTOCOL_VERSION,
            requestId: value.requestId,
            type,
            payload: { code: value.payload.code },
          }
        : null;
    case "leave_room":
      return {
        version: PROTOCOL_VERSION,
        requestId: value.requestId,
        type,
        payload: {},
      };
    case "set_ready":
      return typeof value.payload.ready === "boolean"
        ? {
            version: PROTOCOL_VERSION,
            requestId: value.requestId,
            type,
            payload: { ready: value.payload.ready },
          }
        : null;
    case "prepare_to_start":
      return {
        version: PROTOCOL_VERSION,
        requestId: value.requestId,
        type,
        payload: {},
      };
    case "get_snapshot":
      return {
        version: PROTOCOL_VERSION,
        requestId: value.requestId,
        type,
        payload: {},
      };
    case "start_race":
      return {
        version: PROTOCOL_VERSION,
        requestId: value.requestId,
        type,
        payload: {},
      };
    case "get_race_snapshot":
      return {
        version: PROTOCOL_VERSION,
        requestId: value.requestId,
        type,
        payload: {},
      };
    case "move_input":
      return isUuid(value.payload.raceId) &&
        Number.isSafeInteger(value.payload.sequence) &&
        (value.payload.sequence as number) > 0 &&
        (value.payload.sequence as number) <= 2_147_483_647 &&
        [-1, 0, 1].includes(value.payload.horizontal as number) &&
        typeof value.payload.jumpDown === "boolean"
        ? {
            version: PROTOCOL_VERSION,
            requestId: value.requestId,
            type,
            payload: {
              raceId: value.payload.raceId,
              sequence: value.payload.sequence as number,
              horizontal: value.payload.horizontal as -1 | 0 | 1,
              jumpDown: value.payload.jumpDown,
            },
          }
        : null;
    case "activate_power_up":
      return isUuid(value.payload.raceId) &&
        [0, 1].includes(value.payload.slot as number)
        ? {
            version: PROTOCOL_VERSION,
            requestId: value.requestId,
            type,
            payload: {
              raceId: value.payload.raceId,
              slot: value.payload.slot as 0 | 1,
            },
          }
        : null;
  }
}

export function parseServerMessage(value: unknown): ServerMessage | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["version", "requestId", "type", "payload"]) ||
    value.version !== PROTOCOL_VERSION ||
    typeof value.type !== "string" ||
    !isRecord(value.payload)
  )
    return null;
  if (value.requestId !== null && typeof value.requestId !== "string")
    return null;
  const message = value as unknown as ServerMessage;
  if (value.type === "protocol_error") {
    if (
      !hasExactKeys(value.payload, ["code", "message"]) ||
      typeof value.payload.code !== "string" ||
      !PROTOCOL_ERROR_CODES.has(value.payload.code as ProtocolErrorCode) ||
      typeof value.payload.message !== "string"
    )
      return null;
    return message;
  }
  if (
    ["room_created", "room_joined", "room_snapshot_updated"].includes(
      value.type,
    )
  ) {
    return hasExactKeys(value.payload, ["room"]) &&
      isRoomSnapshot(value.payload.room)
      ? message
      : null;
  }
  if (value.type === "authenticated")
    return hasExactKeys(value.payload, ["guest", "room", "race"]) &&
      isGuestProfile(value.payload.guest) &&
      (value.payload.room === null || isRoomSnapshot(value.payload.room)) &&
      (value.payload.race === null || isRaceSessionSnapshot(value.payload.race))
      ? message
      : null;
  if (value.type === "authentication_result")
    return (hasExactKeys(value.payload, ["ok"]) &&
      value.payload.ok === false) ||
      (hasExactKeys(value.payload, ["ok", "guest"]) &&
        value.payload.ok === true &&
        isGuestProfile(value.payload.guest))
      ? message
      : null;
  if (value.type === "player_joined")
    return hasExactKeys(value.payload, ["player"]) &&
      isRoomPlayer(value.payload.player)
      ? message
      : null;
  if (value.type === "player_left")
    return hasExactKeys(value.payload, ["guestId"]) &&
      isUuid(value.payload.guestId)
      ? message
      : null;
  if (value.type === "player_connection_status_changed")
    return hasExactKeys(value.payload, ["guestId", "connected"]) &&
      isUuid(value.payload.guestId) &&
      typeof value.payload.connected === "boolean"
      ? message
      : null;
  if (value.type === "ready_status_changed")
    return hasExactKeys(value.payload, ["guestId", "ready"]) &&
      isUuid(value.payload.guestId) &&
      typeof value.payload.ready === "boolean"
      ? message
      : null;
  if (value.type === "room_closed")
    return hasExactKeys(value.payload, ["roomId", "reason"]) &&
      isUuid(value.payload.roomId) &&
      ["host_left", "expired", "empty", "host_timeout"].includes(
        String(value.payload.reason),
      )
      ? message
      : null;
  if (value.type === "ready_to_start_result")
    return hasExactKeys(value.payload, ["eligible", "message"]) &&
      typeof value.payload.eligible === "boolean" &&
      typeof value.payload.message === "string"
      ? message
      : null;
  if (value.type === "race_snapshot")
    return hasExactKeys(value.payload, ["race"]) &&
      (value.payload.race === null || isRaceSessionSnapshot(value.payload.race))
      ? message
      : null;
  if (value.type === "gameplay_snapshot")
    return isGameplaySnapshot(value.payload) ? message : null;
  if (value.type === "race_results")
    return hasExactKeys(value.payload, ["raceId", "durationMs", "results"]) &&
      isUuid(value.payload.raceId) &&
      Number.isSafeInteger(value.payload.durationMs) &&
      (value.payload.durationMs as number) >= 0 &&
      Array.isArray(value.payload.results) &&
      value.payload.results.every(isRaceResultEntry)
      ? message
      : null;
  if (
    [
      "race_countdown_started",
      "race_started",
      "race_cancelled",
      "race_state_changed",
    ].includes(value.type)
  )
    return hasExactKeys(value.payload, ["race"]) &&
      isRaceSessionSnapshot(value.payload.race) &&
      ((value.type === "race_countdown_started" &&
        value.payload.race.state === "Countdown") ||
        (value.type === "race_started" &&
          value.payload.race.state === "InProgress") ||
        (value.type === "race_cancelled" &&
          value.payload.race.state === "Cancelled") ||
        value.type === "race_state_changed")
      ? message
      : null;
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => key in value)
  );
}

const PROTOCOL_ERROR_CODES = new Set<ProtocolErrorCode>([
  "MALFORMED_MESSAGE",
  "UNSUPPORTED_VERSION",
  "UNAUTHENTICATED",
  "INVALID_TOKEN",
  "INVALID_NAME",
  "INVALID_COLOR",
  "INVALID_BALL_SKIN",
  "ROOM_NOT_FOUND",
  "ROOM_FULL",
  "ROOM_CLOSED",
  "ROOM_RACE_ACTIVE",
  "ALREADY_IN_ROOM",
  "NOT_IN_ROOM",
  "NOT_HOST",
  "NOT_READY",
  "NOT_IN_RACE",
  "INVALID_INPUT",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
]);

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function nullableDate(value: unknown): boolean {
  return (
    value === null ||
    (typeof value === "string" && Number.isFinite(Date.parse(value)))
  );
}

function isGameplaySnapshot(value: unknown): value is GameplaySnapshot {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "protocolVersion",
      "raceId",
      "snapshotSequence",
      "simulationTick",
      "roomId",
      "serverTimestamp",
      "world",
      "players",
      "checkpointId",
      "checkpoints",
      "pickups",
      "environment",
      "results",
      "diagnostics",
    ]) ||
    value.protocolVersion !== PROTOCOL_VERSION ||
    !isUuid(value.raceId) ||
    !isUuid(value.roomId) ||
    !Number.isSafeInteger(value.snapshotSequence) ||
    (value.snapshotSequence as number) < 0 ||
    !Number.isSafeInteger(value.simulationTick) ||
    (value.simulationTick as number) < 0 ||
    typeof value.serverTimestamp !== "string" ||
    !Number.isFinite(Date.parse(value.serverTimestamp)) ||
    !isRecord(value.world) ||
    !hasExactKeys(value.world, ["width", "height", "revision"]) ||
    value.world.width !== 2400 ||
    value.world.height !== 900 ||
    value.world.revision !== "bbm-physics-v3" ||
    !Array.isArray(value.players) ||
    value.players.length < 2 ||
    value.players.length > 3 ||
    !value.players.every(isGameplayPlayerSnapshot) ||
    (value.checkpointId !== null && typeof value.checkpointId !== "string") ||
    !Array.isArray(value.checkpoints) ||
    !value.checkpoints.every(isCheckpointSnapshot) ||
    !Array.isArray(value.pickups) ||
    !value.pickups.every(isPickupSnapshot) ||
    !isRecord(value.environment) ||
    !hasExactKeys(value.environment, [
      "movingPlatforms",
      "fallingBlocks",
      "crushingTraps",
    ]) ||
    !Array.isArray(value.environment.movingPlatforms) ||
    !Array.isArray(value.environment.fallingBlocks) ||
    !Array.isArray(value.environment.crushingTraps) ||
    !value.environment.movingPlatforms.every(isEnvironmentRect) ||
    !value.environment.crushingTraps.every(isEnvironmentRect) ||
    !value.environment.fallingBlocks.every(
      (item) =>
        isRecord(item) &&
        hasExactKeys(item, ["id", "x", "y", "width", "height", "state"]) &&
        typeof item.state === "string" &&
        ["idle", "falling", "resetting"].includes(item.state) &&
        [item.id, item.x, item.y, item.width, item.height].every(
          (n) =>
            typeof n === "string" ||
            (typeof n === "number" && Number.isFinite(n)),
        ) &&
        typeof item.id === "string" &&
        Number(item.width) > 0 &&
        Number(item.height) > 0,
    ) ||
    (value.results !== null &&
      (!Array.isArray(value.results) ||
        !value.results.every(isRaceResultEntry))) ||
    !isRecord(value.diagnostics) ||
    !hasExactKeys(value.diagnostics, [
      "simulationTickRate",
      "snapshotRate",
      "connectedPlayers",
      "activeSimulations",
      "inputQueueSize",
      "snapshotQueueSize",
      "droppedInputs",
      "rejectedInputs",
      "droppedSimulationTicks",
      "collisionIterations",
      "collisionResolutionMs",
      "activePowerUps",
      "respawningPlayers",
      "availablePickups",
      "finishedPlayers",
      "snapshotBytes",
      "rejectedCommands",
    ]) ||
    Object.values(value.diagnostics).some(
      (entry) => !Number.isSafeInteger(entry) || (entry as number) < 0,
    )
  )
    return false;
  return value.players.every((player) => player.raceId === value.raceId);
}

function isEnvironmentRect(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["id", "x", "y", "width", "height"]) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    [value.x, value.y, value.width, value.height].every(
      (n) => typeof n === "number" && Number.isFinite(n),
    ) &&
    Number(value.width) > 0 &&
    Number(value.height) > 0
  );
}

function isGameplayPlayerSnapshot(
  value: unknown,
): value is GameplayPlayerSnapshot & { raceId: string } {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "guestId",
      "raceId",
      "displayName",
      "color",
      "ballSkin",
      "x",
      "y",
      "velocityX",
      "velocityY",
      "grounded",
      "jumpsUsed",
      "jumpHeld",
      "lastProcessedInputSequence",
      "connected",
      "simulationTick",
      "updatedAt",
      "radius",
      "mass",
      "ghost",
      "respawning",
      "respawnAt",
      "inventory",
      "activeEffects",
      "finished",
      "finishPlace",
      "finishedAt",
    ]) &&
    isUuid(value.guestId) &&
    isUuid(value.raceId) &&
    typeof value.displayName === "string" &&
    typeof value.color === "string" &&
    BALL_COLORS.includes(value.color as BallColor) &&
    BALL_SKINS.includes(value.ballSkin as BallSkin) &&
    [value.x, value.y, value.velocityX, value.velocityY].every(
      Number.isFinite,
    ) &&
    typeof value.grounded === "boolean" &&
    Number.isInteger(value.jumpsUsed) &&
    (value.jumpsUsed as number) >= 0 &&
    (value.jumpsUsed as number) <= 2 &&
    typeof value.jumpHeld === "boolean" &&
    Number.isSafeInteger(value.lastProcessedInputSequence) &&
    (value.lastProcessedInputSequence as number) >= 0 &&
    typeof value.connected === "boolean" &&
    Number.isSafeInteger(value.simulationTick) &&
    (value.simulationTick as number) >= 0 &&
    typeof value.updatedAt === "string" &&
    Number.isFinite(Date.parse(value.updatedAt)) &&
    Number.isFinite(value.radius) &&
    (value.radius as number) > 0 &&
    Number.isFinite(value.mass) &&
    (value.mass as number) > 0 &&
    typeof value.ghost === "boolean" &&
    typeof value.respawning === "boolean" &&
    nullableDate(value.respawnAt) &&
    Array.isArray(value.inventory) &&
    value.inventory.length <= 2 &&
    value.inventory.every(isPowerUpType) &&
    Array.isArray(value.activeEffects) &&
    value.activeEffects.every(isActivePowerUp) &&
    typeof value.finished === "boolean" &&
    (value.finishPlace === null ||
      [1, 2, 3].includes(value.finishPlace as number)) &&
    nullableDate(value.finishedAt)
  );
}

function isPowerUpType(value: unknown): value is PowerUpType {
  return (
    typeof value === "string" && POWER_UP_TYPES.includes(value as PowerUpType)
  );
}
function isActivePowerUp(value: unknown): value is ActivePowerUp {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["type", "expiresAt"]) &&
    isPowerUpType(value.type) &&
    typeof value.expiresAt === "string" &&
    Number.isFinite(Date.parse(value.expiresAt))
  );
}
function isCheckpointSnapshot(value: unknown): value is CheckpointSnapshot {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["id", "x", "y", "activated"]) &&
    typeof value.id === "string" &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    typeof value.activated === "boolean"
  );
}
function isPickupSnapshot(value: unknown): value is PickupSnapshot {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["id", "type", "x", "y", "available", "availableAt"]) &&
    typeof value.id === "string" &&
    isPowerUpType(value.type) &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    typeof value.available === "boolean" &&
    nullableDate(value.availableAt)
  );
}
function isRaceResultEntry(value: unknown): value is RaceResultEntry {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "guestId",
      "displayName",
      "color",
      "place",
      "finishTimeMs",
      "status",
    ]) &&
    isUuid(value.guestId) &&
    typeof value.displayName === "string" &&
    BALL_COLORS.includes(value.color as BallColor) &&
    (value.place === null || [1, 2, 3].includes(value.place as number)) &&
    (value.finishTimeMs === null ||
      (Number.isSafeInteger(value.finishTimeMs) &&
        (value.finishTimeMs as number) >= 0)) &&
    ["finished", "unfinished", "disconnected"].includes(value.status as string)
  );
}
function isGuestProfile(value: unknown): value is GuestProfile {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["id", "displayName", "color", "ballSkin"]) &&
    isUuid(value.id) &&
    typeof value.displayName === "string" &&
    [...value.displayName].length >= 2 &&
    [...value.displayName].length <= 20 &&
    typeof value.color === "string" &&
    BALL_COLORS.includes(value.color as BallColor) &&
    BALL_SKINS.includes(value.ballSkin as BallSkin)
  );
}
function isRoomPlayer(value: unknown): value is RoomPlayer {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "guestId",
      "displayName",
      "color",
      "ballSkin",
      "host",
      "connected",
      "ready",
    ]) &&
    isUuid(value.guestId) &&
    typeof value.displayName === "string" &&
    typeof value.color === "string" &&
    BALL_COLORS.includes(value.color as BallColor) &&
    BALL_SKINS.includes(value.ballSkin as BallSkin) &&
    typeof value.host === "boolean" &&
    typeof value.connected === "boolean" &&
    typeof value.ready === "boolean"
  );
}
function isRoomSnapshot(value: unknown): value is RoomSnapshot {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "roomId",
      "revision",
      "code",
      "status",
      "hostGuestId",
      "players",
      "minPlayers",
      "maxPlayers",
      "canPrepareToStart",
      "expiresAt",
    ]) &&
    isUuid(value.roomId) &&
    Number.isSafeInteger(value.revision) &&
    typeof value.code === "string" &&
    /^[A-HJ-NP-Z2-9]{6}$/.test(value.code) &&
    isUuid(value.hostGuestId) &&
    ["open", "closed", "expired"].includes(String(value.status)) &&
    Array.isArray(value.players) &&
    value.players.length <= 3 &&
    value.players.every(isRoomPlayer) &&
    value.minPlayers === 2 &&
    value.maxPlayers === 3 &&
    typeof value.canPrepareToStart === "boolean" &&
    typeof value.expiresAt === "string" &&
    Number.isFinite(Date.parse(value.expiresAt))
  );
}

function isRaceSessionSnapshot(value: unknown): value is RaceSessionSnapshot {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "raceId",
      "roomId",
      "revision",
      "state",
      "countdownStartedAt",
      "countdownDeadlineAt",
      "officialStartAt",
      "timeoutDeadlineAt",
      "cancellationReason",
      "cancelledAt",
      "finishedAt",
      "createdAt",
      "updatedAt",
      "serverNow",
    ]) ||
    !isUuid(value.raceId) ||
    !isUuid(value.roomId) ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0 ||
    !["Waiting", "Countdown", "InProgress", "Finished", "Cancelled"].includes(
      String(value.state),
    )
  )
    return false;
  const nullableDate = (date: unknown) =>
    date === null ||
    (typeof date === "string" && Number.isFinite(Date.parse(date)));
  const validFields =
    nullableDate(value.countdownStartedAt) &&
    nullableDate(value.countdownDeadlineAt) &&
    nullableDate(value.officialStartAt) &&
    nullableDate(value.timeoutDeadlineAt) &&
    nullableDate(value.cancelledAt) &&
    nullableDate(value.finishedAt) &&
    typeof value.createdAt === "string" &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    typeof value.updatedAt === "string" &&
    Number.isFinite(Date.parse(value.updatedAt)) &&
    typeof value.serverNow === "string" &&
    Number.isFinite(Date.parse(value.serverNow)) &&
    (value.cancellationReason === null ||
      ["Timeout", "HostLeft", "RoomExpired", "ServerRestart"].includes(
        String(value.cancellationReason),
      ));
  if (!validFields) return false;

  const hasCountdown =
    value.countdownStartedAt !== null && value.countdownDeadlineAt !== null;
  const hasOfficialStart = value.officialStartAt !== null;
  const hasTimeout = value.timeoutDeadlineAt !== null;
  const hasCancellation =
    value.cancellationReason !== null && value.cancelledAt !== null;
  const hasFinish = value.finishedAt !== null;
  if (
    hasOfficialStart !== hasTimeout ||
    hasCancellation !== (value.state === "Cancelled") ||
    hasFinish !== (value.state === "Finished")
  )
    return false;
  if (
    hasOfficialStart &&
    (value.officialStartAt !== value.countdownDeadlineAt ||
      Date.parse(value.timeoutDeadlineAt as string) <=
        Date.parse(value.officialStartAt as string))
  )
    return false;
  switch (value.state) {
    case "Waiting":
      return (
        !hasCountdown && !hasOfficialStart && !hasCancellation && !hasFinish
      );
    case "Countdown":
      return (
        hasCountdown && !hasOfficialStart && !hasCancellation && !hasFinish
      );
    case "InProgress":
      return hasCountdown && hasOfficialStart && !hasCancellation && !hasFinish;
    case "Finished":
      return hasCountdown && hasOfficialStart && !hasCancellation && hasFinish;
    case "Cancelled":
      return hasCountdown && hasCancellation;
    default:
      return false;
  }
}
