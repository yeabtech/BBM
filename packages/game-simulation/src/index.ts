export interface MovementConfig {
  readonly maxHorizontalSpeed: number;
  readonly groundAcceleration: number;
  readonly groundDeceleration: number;
  readonly airAcceleration: number;
  readonly airControlMultiplier: number;
  readonly gravity: number;
  readonly groundJumpVelocity: number;
  readonly doubleJumpVelocity: number;
  readonly maxJumpCount: number;
  readonly worldCollision: {
    readonly left: boolean;
    readonly right: boolean;
    readonly top: boolean;
    readonly bottom: boolean;
  };
  readonly worldWidth: number;
  readonly worldHeight: number;
  readonly fallResetY: number;
  readonly playerHalfSize: number;
  readonly maxVerticalSpeed: number;
  readonly revision: string;
}

export const MOVEMENT_CONFIG: MovementConfig = Object.freeze({
  maxHorizontalSpeed: 270,
  groundAcceleration: 1500,
  groundDeceleration: 1850,
  airAcceleration: 900,
  airControlMultiplier: 0.72,
  gravity: 1050,
  groundJumpVelocity: 510,
  doubleJumpVelocity: 470,
  maxJumpCount: 2,
  worldCollision: Object.freeze({
    left: true,
    right: true,
    top: true,
    bottom: false,
  }),
  worldWidth: 2400,
  worldHeight: 900,
  fallResetY: 700,
  playerHalfSize: 22,
  maxVerticalSpeed: 900,
  revision: "bbm-physics-v3",
});

export const PLAYER_COLLISION_CONFIG = Object.freeze({
  restitution: 0.45,
  restingImpactSpeed: 35,
  friction: 1.5,
  contactOffset: 2,
  horizontalDamping: 0.92,
  verticalDamping: 0.96,
  maxImpulse: 900,
  separationTolerance: 0.5,
  correctionPercent: 0.65,
  iterations: 8,
});
export const POWER_UP_CONFIG = Object.freeze({
  durationMs: 8_000,
  pickupRespawnMs: 15_000,
  speedMultiplier: 1.35,
  jumpMultiplier: 1.3,
  heavyMass: 2.5,
  shrinkRadius: 14,
  shockwaveRadius: 280,
  shockwaveBaseImpulse: 220,
  shockwaveMaxImpulse: 500,
});
export const RACE_OBJECT_CONFIG = Object.freeze({
  respawnDelayMs: 1_500,
  checkpointActivationRadius: 24,
  pickupActivationRadius: 18,
});

export interface PlatformDefinition {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly kind?: "ground" | "platform";
}

export interface HazardDefinition {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface TestLevelDefinition {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly start: { readonly x: number; readonly y: number };
  readonly finishX: number;
  readonly platforms: readonly PlatformDefinition[];
  readonly hazards: readonly HazardDefinition[];
  readonly movingPlatforms: readonly {
    readonly id: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly endX: number;
    readonly endY: number;
    readonly periodSeconds: number;
  }[];
  readonly fallingBlocks: readonly {
    readonly id: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly triggerX: number;
    readonly triggerY: number;
    readonly triggerRadius: number;
    readonly fallSeconds: number;
    readonly resetSeconds: number;
  }[];
  readonly crushingTraps: readonly {
    readonly id: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly endY: number;
    readonly periodSeconds: number;
  }[];
  readonly checkpoints: readonly {
    readonly id: string;
    readonly x: number;
    readonly y: number;
  }[];
  readonly pickups: readonly {
    readonly id: string;
    readonly type:
      "speed" | "jump" | "heavy" | "shockwave" | "shrink" | "ghost";
    readonly x: number;
    readonly y: number;
  }[];
}

export interface PlayerMovementState {
  horizontalVelocity: number;
  jumpsUsed: number;
}

export interface HorizontalInput {
  axis: -1 | 0 | 1;
  grounded: boolean;
  deltaSeconds: number;
}

export interface JumpResult {
  readonly jumped: boolean;
  readonly velocityY: number | null;
  readonly jumpsUsed: number;
}

export function stepHorizontalMovement(
  state: PlayerMovementState,
  input: HorizontalInput,
  config: MovementConfig = MOVEMENT_CONFIG,
): number {
  const dt = Math.min(Math.max(input.deltaSeconds, 0), 1 / 20);
  const current = state.horizontalVelocity;
  const deceleration = input.grounded
    ? config.groundDeceleration
    : config.groundDeceleration * config.airControlMultiplier;
  const acceleration = input.grounded
    ? config.groundAcceleration
    : config.airAcceleration * config.airControlMultiplier;
  const next =
    input.axis === 0
      ? approach(current, 0, deceleration * dt)
      : current + input.axis * acceleration * dt;
  state.horizontalVelocity = clamp(
    next,
    -config.maxHorizontalSpeed,
    config.maxHorizontalSpeed,
  );
  return state.horizontalVelocity;
}

export function processJump(
  state: PlayerMovementState,
  jumpPressed: boolean,
  grounded: boolean,
  config: MovementConfig = MOVEMENT_CONFIG,
): JumpResult {
  if (grounded) state.jumpsUsed = 0;
  if (
    !jumpPressed ||
    state.jumpsUsed >= config.maxJumpCount ||
    (!grounded && state.jumpsUsed === 0)
  )
    return { jumped: false, velocityY: null, jumpsUsed: state.jumpsUsed };
  const velocityY =
    state.jumpsUsed === 0
      ? -config.groundJumpVelocity
      : -config.doubleJumpVelocity;
  state.jumpsUsed += 1;
  return { jumped: true, velocityY, jumpsUsed: state.jumpsUsed };
}

export function resetPlayerMovement(state: PlayerMovementState): void {
  state.horizontalVelocity = 0;
  state.jumpsUsed = 0;
}

export function validateMovementConfig(config: MovementConfig): string[] {
  const errors: string[] = [];
  for (const key of [
    "maxHorizontalSpeed",
    "groundAcceleration",
    "groundDeceleration",
    "airAcceleration",
    "gravity",
    "groundJumpVelocity",
    "doubleJumpVelocity",
    "worldWidth",
    "worldHeight",
    "fallResetY",
    "playerHalfSize",
    "maxVerticalSpeed",
  ] as const) {
    if (!Number.isFinite(config[key]) || config[key] <= 0)
      errors.push(`${key} must be a positive finite number`);
  }
  if (
    !Number.isFinite(config.airControlMultiplier) ||
    config.airControlMultiplier < 0 ||
    config.airControlMultiplier > 1
  )
    errors.push("airControlMultiplier must be between 0 and 1");
  if (!Number.isInteger(config.maxJumpCount) || config.maxJumpCount < 1)
    errors.push("maxJumpCount must be a positive integer");
  if (config.fallResetY >= config.worldHeight)
    errors.push("fallResetY must be below worldHeight");
  return errors;
}

export function validateLevel(level: TestLevelDefinition): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(level.width) || level.width <= 0)
    errors.push("width must be positive");
  if (!Number.isFinite(level.height) || level.height <= 0)
    errors.push("height must be positive");
  if (
    ![level.start.x, level.start.y].every(Number.isFinite) ||
    level.start.x < 0 ||
    level.start.y < 0 ||
    level.start.x > level.width ||
    level.start.y > level.height
  )
    errors.push("start must be inside the level");
  if (
    !Number.isFinite(level.finishX) ||
    level.finishX < 0 ||
    level.finishX > level.width
  )
    errors.push("finishX must be inside the level");
  for (const [index, platform] of level.platforms.entries()) {
    if (
      ![platform.x, platform.y, platform.width, platform.height].every(
        Number.isFinite,
      ) ||
      platform.x < 0 ||
      platform.y < 0 ||
      platform.width <= 0 ||
      platform.height <= 0
    )
      errors.push(`platform ${index} has invalid bounds`);
    if (
      platform.x + platform.width > level.width ||
      platform.y + platform.height > level.height
    )
      errors.push(`platform ${index} exceeds level bounds`);
  }
  for (const [index, hazard] of level.hazards.entries()) {
    if (
      ![hazard.x, hazard.y, hazard.width, hazard.height].every(
        Number.isFinite,
      ) ||
      hazard.x < 0 ||
      hazard.y < 0 ||
      hazard.width <= 0 ||
      hazard.height <= 0
    )
      errors.push(`hazard ${index} has invalid bounds`);
    if (
      hazard.x + hazard.width > level.width ||
      hazard.y + hazard.height > level.height
    )
      errors.push(`hazard ${index} exceeds level bounds`);
  }
  for (const [index, item] of [
    ...level.checkpoints,
    ...level.pickups,
  ].entries())
    if (
      !item.id ||
      ![item.x, item.y].every(Number.isFinite) ||
      item.x < 0 ||
      item.y < 0 ||
      item.x > level.width ||
      item.y > level.height
    )
      errors.push(`interactive level object ${index} has invalid bounds`);
  return errors;
}

export const TEST_LEVEL: TestLevelDefinition = Object.freeze({
  id: "greenway-rush",
  name: "Greenway Rush",
  width: 2400,
  height: 900,
  start: { x: 110, y: 414 },
  finishX: 2260,
  platforms: [
    { x: 0, y: 450, width: 650, height: 100, kind: "ground" },
    { x: 760, y: 390, width: 260, height: 32 },
    { x: 1050, y: 450, width: 260, height: 100, kind: "ground" },
    { x: 1390, y: 350, width: 250, height: 32 },
    { x: 1720, y: 450, width: 680, height: 100, kind: "ground" },
    { x: 1170, y: 300, width: 110, height: 24 },
    { x: 1960, y: 380, width: 150, height: 24 },
  ],
  hazards: [{ x: 1840, y: 420, width: 84, height: 30 }],
  movingPlatforms: [
    {
      id: "lift-gap-a",
      x: 650,
      y: 414,
      width: 100,
      height: 20,
      endX: 760,
      endY: 414,
      periodSeconds: 4,
    },
    {
      id: "lift-skill-b",
      x: 1305,
      y: 354,
      width: 84,
      height: 20,
      endX: 1305,
      endY: 270,
      periodSeconds: 3.5,
    },
  ],
  fallingBlocks: [
    {
      id: "falling-block-a",
      x: 1640,
      y: 270,
      width: 42,
      height: 42,
      triggerX: 1600,
      triggerY: 350,
      triggerRadius: 140,
      fallSeconds: 0.8,
      resetSeconds: 3,
    },
  ],
  crushingTraps: [
    {
      id: "crusher-a",
      x: 1880,
      y: 300,
      width: 80,
      height: 26,
      endY: 410,
      periodSeconds: 3,
    },
  ],
  checkpoints: [
    { id: "checkpoint-1", x: 560, y: 428 },
    { id: "checkpoint-2", x: 1480, y: 328 },
  ],
  pickups: [
    { id: "pickup-speed", type: "speed", x: 500, y: 420 },
    { id: "pickup-jump", type: "jump", x: 850, y: 360 },
    { id: "pickup-heavy", type: "heavy", x: 1130, y: 420 },
    { id: "pickup-shockwave", type: "shockwave", x: 1510, y: 320 },
    { id: "pickup-shrink", type: "shrink", x: 1800, y: 420 },
    { id: "pickup-ghost", type: "ghost", x: 2150, y: 420 },
  ],
} satisfies TestLevelDefinition);

export const SPAWN_X = [160, 220, 280] as const;
export const SIMULATION_TICK_SECONDS = 1 / 60;
export const SIMULATION_MAX_CATCH_UP_TICKS = 8;
export const INPUT_QUEUE_LIMIT = 64;
export const INPUTS_PER_SECOND_LIMIT = 120;
export const DISCONNECT_NEUTRAL_MS = 250;
export const SNAPSHOT_INTERVAL_MS = 50;

export interface EnvironmentSnapshot {
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
}

/** Deterministic environment coordinates derived solely from authoritative simulation time. */
export function environmentAt(seconds: number): EnvironmentSnapshot {
  const triangle = (time: number, period: number): number => {
    const phase = (((time % period) + period) % period) / period;
    return phase < 0.5 ? phase * 2 : (1 - phase) * 2;
  };
  return {
    movingPlatforms: TEST_LEVEL.movingPlatforms.map((item) => {
      const t = triangle(seconds, item.periodSeconds);
      return {
        id: item.id,
        x: item.x + (item.endX - item.x) * t,
        y: item.y + (item.endY - item.y) * t,
        width: item.width,
        height: item.height,
      };
    }),
    fallingBlocks: TEST_LEVEL.fallingBlocks.map((item) => ({
      id: item.id,
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
      state: "idle" as const,
    })),
    crushingTraps: TEST_LEVEL.crushingTraps.map((item) => {
      const t = triangle(seconds, item.periodSeconds);
      return {
        id: item.id,
        x: item.x,
        y: item.y + (item.endY - item.y) * t,
        width: item.width,
        height: item.height,
      };
    }),
  };
}

export interface GamePlayerState {
  guestId: string;
  playerId: string;
  raceId: string;
  slot: number;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  grounded: boolean;
  jumpsUsed: number;
  jumpDown: boolean;
  lastProcessedInputSequence: number;
  lastAcceptedInputAtMs: number;
  connected: boolean;
  tick: number;
  updatedAtMs: number;
  horizontal: -1 | 0 | 1;
  lastInput: GameInputIntent | null;
  mass: number;
  radius: number;
  ghost: boolean;
  finished: boolean;
  speedMultiplier: number;
  jumpMultiplier: number;
  supportedByPlayer?: boolean;
  supportVelocityX?: number;
}

export interface GameInputIntent {
  sequence: number;
  horizontal: -1 | 0 | 1;
  jumpDown: boolean;
  receivedAtMs: number;
}

export function spawnPlayer(
  guestId: string,
  raceId: string,
  slot: number,
  nowMs: number,
): GamePlayerState {
  const x = SPAWN_X[Math.max(0, Math.min(SPAWN_X.length - 1, slot))]!;
  const ground = TEST_LEVEL.platforms[0]!;
  return {
    guestId,
    playerId: guestId,
    raceId,
    slot,
    x,
    y: ground.y - MOVEMENT_CONFIG.playerHalfSize,
    velocityX: 0,
    velocityY: 0,
    grounded: true,
    jumpsUsed: 0,
    jumpDown: false,
    lastProcessedInputSequence: 0,
    lastAcceptedInputAtMs: nowMs,
    connected: true,
    tick: 0,
    updatedAtMs: nowMs,
    horizontal: 0,
    lastInput: null,
    mass: 1,
    radius: MOVEMENT_CONFIG.playerHalfSize,
    ghost: false,
    finished: false,
    speedMultiplier: 1,
    jumpMultiplier: 1,
    supportedByPlayer: false,
    supportVelocityX: 0,
  };
}

export function stepPlayer(
  player: GamePlayerState,
  input: Pick<GameInputIntent, "horizontal" | "jumpDown"> & {
    readonly jumpPressed?: boolean;
  },
  deltaSeconds = SIMULATION_TICK_SECONDS,
  resetOnHazard = true,
  platforms: readonly PlatformDefinition[] = TEST_LEVEL.platforms,
): void {
  const config: MovementConfig = {
    ...MOVEMENT_CONFIG,
    maxHorizontalSpeed:
      MOVEMENT_CONFIG.maxHorizontalSpeed * player.speedMultiplier,
    groundAcceleration:
      MOVEMENT_CONFIG.groundAcceleration * player.speedMultiplier,
    airAcceleration: MOVEMENT_CONFIG.airAcceleration * player.speedMultiplier,
    groundJumpVelocity:
      MOVEMENT_CONFIG.groundJumpVelocity * player.jumpMultiplier,
    doubleJumpVelocity:
      MOVEMENT_CONFIG.doubleJumpVelocity * player.jumpMultiplier,
  };
  const groundedBefore = player.grounded;
  const jumpPressed = input.jumpPressed ?? (input.jumpDown && !player.jumpDown);
  player.jumpDown = input.jumpDown;

  if (groundedBefore) player.jumpsUsed = 0;
  if (jumpPressed && player.jumpsUsed < config.maxJumpCount) {
    if (groundedBefore || player.jumpsUsed > 0) {
      player.velocityY =
        player.jumpsUsed === 0
          ? -config.groundJumpVelocity
          : -config.doubleJumpVelocity;
      player.jumpsUsed += 1;
      player.grounded = false;
    }
  }

  player.velocityX =
    player.supportedByPlayer && input.horizontal === 0
      ? (player.supportVelocityX ?? 0)
      : stepHorizontalMovement(
          { horizontalVelocity: player.velocityX, jumpsUsed: player.jumpsUsed },
          { axis: input.horizontal, grounded: groundedBefore, deltaSeconds },
          config,
        );

  const half = player.radius;
  const previousX = player.x;
  let nextX = previousX + player.velocityX * deltaSeconds;
  for (const platform of platforms) {
    const verticalOverlap =
      player.y + half > platform.y &&
      player.y - half < platform.y + platform.height;
    if (!verticalOverlap) continue;
    if (
      player.velocityX > 0 &&
      previousX + half <= platform.x &&
      nextX + half > platform.x
    ) {
      nextX = platform.x - half;
      player.velocityX = 0;
    } else if (
      player.velocityX < 0 &&
      previousX - half >= platform.x + platform.width &&
      nextX - half < platform.x + platform.width
    ) {
      nextX = platform.x + platform.width + half;
      player.velocityX = 0;
    }
  }
  if (nextX < half) {
    nextX = half;
    player.velocityX = 0;
  }
  if (nextX > config.worldWidth - half) {
    nextX = config.worldWidth - half;
    player.velocityX = 0;
  }
  player.x = nextX;

  player.velocityY = Math.min(
    config.maxVerticalSpeed,
    player.velocityY + config.gravity * deltaSeconds,
  );
  const previousY = player.y;
  let nextY = previousY + player.velocityY * deltaSeconds;
  player.grounded = false;
  if (previousY - half >= 0 && nextY - half < 0) {
    nextY = half;
    player.velocityY = Math.max(0, player.velocityY);
  }
  for (const platform of platforms) {
    const horizontalOverlap =
      player.x + half > platform.x &&
      player.x - half < platform.x + platform.width;
    if (!horizontalOverlap) continue;
    if (
      player.velocityY >= 0 &&
      previousY + half <= platform.y &&
      nextY + half >= platform.y
    ) {
      nextY = platform.y - half;
      player.velocityY = 0;
      player.grounded = true;
      player.jumpsUsed = 0;
    } else if (
      player.velocityY < 0 &&
      previousY - half >= platform.y + platform.height &&
      nextY - half <= platform.y + platform.height
    ) {
      nextY = platform.y + platform.height + half;
      player.velocityY = 0;
    }
  }
  player.y = nextY;

  const hitHazard = TEST_LEVEL.hazards.some(
    (hazard) =>
      player.x + half > hazard.x &&
      player.x - half < hazard.x + hazard.width &&
      player.y + half > hazard.y &&
      player.y - half < hazard.y + hazard.height,
  );
  if (resetOnHazard && (hitHazard || player.y > config.fallResetY)) {
    const spawn = spawnPlayer(
      player.guestId,
      player.raceId,
      player.slot,
      player.updatedAtMs,
    );
    Object.assign(player, spawn, {
      lastProcessedInputSequence: player.lastProcessedInputSequence,
      connected: player.connected,
      lastAcceptedInputAtMs: player.lastAcceptedInputAtMs,
    });
  }
  player.tick += 1;
}

export function playerInHazard(player: GamePlayerState): boolean {
  const radius = player.radius;
  return (
    player.y > MOVEMENT_CONFIG.fallResetY ||
    TEST_LEVEL.hazards.some(
      (hazard) =>
        player.x + radius > hazard.x &&
        player.x - radius < hazard.x + hazard.width &&
        player.y + radius > hazard.y &&
        player.y - radius < hazard.y + hazard.height,
    )
  );
}

/** Deterministic, bounded circle collision resolution; sorted slots define pair order. */
export function resolvePlayerCollisions(players: GamePlayerState[]): number {
  for (const player of players) {
    player.supportedByPlayer = false;
    player.supportVelocityX = 0;
  }
  const ordered = [...players]
    .filter((player) => !player.ghost && !player.finished)
    .sort((a, b) => a.slot - b.slot || a.guestId.localeCompare(b.guestId));
  let iterations = 0;
  for (let pass = 0; pass < PLAYER_COLLISION_CONFIG.iterations; pass += 1) {
    let changed = false;
    for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < ordered.length;
        rightIndex += 1
      ) {
        const left = ordered[leftIndex]!;
        const right = ordered[rightIndex]!;
        let dx = right.x - left.x;
        let dy = right.y - left.y;
        let distance = Math.hypot(dx, dy);
        const minimum = left.radius + right.radius;
        if (distance >= minimum + PLAYER_COLLISION_CONFIG.contactOffset)
          continue;
        if (distance < 1e-6) {
          dx = left.slot <= right.slot ? 1 : -1;
          dy = 0;
          distance = 1;
        }
        const nx = dx / distance;
        const ny = dy / distance;
        const penetration = minimum - distance;
        const correction =
          Math.max(
            0,
            penetration - PLAYER_COLLISION_CONFIG.separationTolerance,
          ) * PLAYER_COLLISION_CONFIG.correctionPercent;
        const leftMass = finitePositive(left.mass, 1);
        const rightMass = finitePositive(right.mass, 1);
        const inverseLeft = 1 / leftMass;
        const inverseRight = 1 / rightMass;
        const inverseTotal = inverseLeft + inverseRight;
        const leftSupportsRight = ny < -0.65 && left.grounded;
        const rightSupportsLeft = ny > 0.65 && right.grounded;
        const impulseInverseLeft = leftSupportsRight ? 0 : inverseLeft;
        const impulseInverseRight = rightSupportsLeft ? 0 : inverseRight;
        const impulseInverseTotal = impulseInverseLeft + impulseInverseRight;
        left.x -= nx * correction * (inverseLeft / inverseTotal);
        left.y -= ny * correction * (inverseLeft / inverseTotal);
        right.x += nx * correction * (inverseRight / inverseTotal);
        right.y += ny * correction * (inverseRight / inverseTotal);
        const relativeVelocity =
          (right.velocityX - left.velocityX) * nx +
          (right.velocityY - left.velocityY) * ny;
        let normalImpulse = 0;
        if (relativeVelocity < 0) {
          const restitution =
            -relativeVelocity < PLAYER_COLLISION_CONFIG.restingImpactSpeed
              ? 0
              : PLAYER_COLLISION_CONFIG.restitution;
          const impulse = Math.min(
            PLAYER_COLLISION_CONFIG.maxImpulse,
            (-(1 + restitution) * relativeVelocity) / impulseInverseTotal,
          );
          normalImpulse = impulse;
          left.velocityX -= impulse * impulseInverseLeft * nx;
          left.velocityY -= impulse * impulseInverseLeft * ny;
          right.velocityX += impulse * impulseInverseRight * nx;
          right.velocityY += impulse * impulseInverseRight * ny;
          left.velocityX *= PLAYER_COLLISION_CONFIG.horizontalDamping;
          right.velocityX *= PLAYER_COLLISION_CONFIG.horizontalDamping;
          left.velocityY *= PLAYER_COLLISION_CONFIG.verticalDamping;
          right.velocityY *= PLAYER_COLLISION_CONFIG.verticalDamping;
        }
        if (leftSupportsRight) {
          left.velocityY = 0;
          right.grounded = true;
          right.jumpsUsed = 0;
          right.supportedByPlayer = true;
          right.supportVelocityX = left.velocityX;
        } else if (rightSupportsLeft) {
          right.velocityY = 0;
          left.grounded = true;
          left.jumpsUsed = 0;
          left.supportedByPlayer = true;
          left.supportVelocityX = right.velocityX;
        }
        if (normalImpulse > 0) {
          const tx = -ny;
          const ty = nx;
          const frictionInverseLeft = leftSupportsRight ? 0 : inverseLeft;
          const frictionInverseRight = rightSupportsLeft ? 0 : inverseRight;
          const frictionInverseTotal =
            frictionInverseLeft + frictionInverseRight;
          const tangentVelocity =
            (right.velocityX - left.velocityX) * tx +
            (right.velocityY - left.velocityY) * ty;
          const frictionImpulse = clamp(
            -tangentVelocity / frictionInverseTotal,
            -normalImpulse * PLAYER_COLLISION_CONFIG.friction,
            normalImpulse * PLAYER_COLLISION_CONFIG.friction,
          );
          left.velocityX -= frictionImpulse * frictionInverseLeft * tx;
          left.velocityY -= frictionImpulse * frictionInverseLeft * ty;
          right.velocityX += frictionImpulse * frictionInverseRight * tx;
          right.velocityY += frictionImpulse * frictionInverseRight * ty;
        }
        constrainToWorld(left);
        constrainToWorld(right);
        if (correction > 1e-3) changed = true;
        iterations += 1;
      }
    }
    for (const player of ordered) resolvePlatformPenetration(player);
    if (!changed) break;
  }
  return iterations;
}

export function applyRadialShockwave(
  source: GamePlayerState,
  targets: readonly GamePlayerState[],
): number {
  let affected = 0;
  for (const target of [...targets].sort((a, b) => a.slot - b.slot)) {
    if (target === source || target.ghost || target.finished) continue;
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 1e-6 || distance > POWER_UP_CONFIG.shockwaveRadius) continue;
    const impulse = Math.min(
      POWER_UP_CONFIG.shockwaveMaxImpulse,
      POWER_UP_CONFIG.shockwaveBaseImpulse +
        POWER_UP_CONFIG.shockwaveRadius -
        distance,
    );
    target.velocityX = clamp(
      target.velocityX + (dx / distance) * impulse,
      -MOVEMENT_CONFIG.maxVerticalSpeed,
      MOVEMENT_CONFIG.maxVerticalSpeed,
    );
    target.velocityY = clamp(
      target.velocityY + (dy / distance) * impulse,
      -MOVEMENT_CONFIG.maxVerticalSpeed,
      MOVEMENT_CONFIG.maxVerticalSpeed,
    );
    target.grounded = false;
    affected += 1;
  }
  return affected;
}

function constrainToWorld(player: GamePlayerState): void {
  const radius = finitePositive(player.radius, MOVEMENT_CONFIG.playerHalfSize);
  player.x = clamp(player.x, radius, MOVEMENT_CONFIG.worldWidth - radius);
  if (player.y < radius) {
    player.y = radius;
    player.velocityY = Math.max(0, player.velocityY);
  }
  player.velocityX = clamp(
    Number.isFinite(player.velocityX) ? player.velocityX : 0,
    -MOVEMENT_CONFIG.maxVerticalSpeed,
    MOVEMENT_CONFIG.maxVerticalSpeed,
  );
  player.velocityY = clamp(
    Number.isFinite(player.velocityY) ? player.velocityY : 0,
    -MOVEMENT_CONFIG.maxVerticalSpeed,
    MOVEMENT_CONFIG.maxVerticalSpeed,
  );
}

function resolvePlatformPenetration(player: GamePlayerState): void {
  const radius = finitePositive(player.radius, MOVEMENT_CONFIG.playerHalfSize);
  for (const platform of TEST_LEVEL.platforms) {
    const closestX = clamp(player.x, platform.x, platform.x + platform.width);
    const closestY = clamp(player.y, platform.y, platform.y + platform.height);
    let dx = player.x - closestX;
    let dy = player.y - closestY;
    let distance = Math.hypot(dx, dy);
    if (distance >= radius) continue;
    if (distance < 1e-6) {
      const edges = [
        { distance: Math.abs(player.x - platform.x), nx: -1, ny: 0 },
        {
          distance: Math.abs(platform.x + platform.width - player.x),
          nx: 1,
          ny: 0,
        },
        { distance: Math.abs(player.y - platform.y), nx: 0, ny: -1 },
        {
          distance: Math.abs(platform.y + platform.height - player.y),
          nx: 0,
          ny: 1,
        },
      ].sort((a, b) => a.distance - b.distance);
      dx = edges[0]!.nx;
      dy = edges[0]!.ny;
      distance = 1;
    }
    const nx = dx / distance;
    const ny = dy / distance;
    const separation =
      radius - distance + PLAYER_COLLISION_CONFIG.separationTolerance;
    player.x += nx * separation;
    player.y += ny * separation;
    const intoSurface = player.velocityX * nx + player.velocityY * ny;
    if (intoSurface < 0) {
      player.velocityX -= intoSurface * nx;
      player.velocityY -= intoSurface * ny;
    }
    if (ny < -0.5) {
      player.grounded = true;
      player.jumpsUsed = 0;
    }
  }
  constrainToWorld(player);
}

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function copyPlayerState(player: GamePlayerState): GamePlayerState {
  return {
    ...player,
    lastInput: player.lastInput ? { ...player.lastInput } : null,
  };
}

function approach(value: number, target: number, amount: number): number {
  if (value < target) return Math.min(value + amount, target);
  return Math.max(value - amount, target);
}
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
