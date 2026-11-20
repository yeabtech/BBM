import type {
  ActivePowerUp,
  BallSkin,
  PowerUpType,
} from "@bbm/shared-contracts";

export const BALL_SKIN_OPTIONS: ReadonlyArray<{
  value: BallSkin;
  label: string;
  file: string;
}> = [
  { value: "soccer", label: "Soccer", file: "soccer-ball.png" },
  { value: "basketball", label: "Basketball", file: "basketball.png" },
  { value: "volleyball", label: "Volleyball", file: "volleyball.png" },
  { value: "beach", label: "Beach ball", file: "beach-ball.png" },
];

const POWER_SKIN_FILES = [
  "steel-ball.png",
  "electric-ball.png",
  "lava-ball.png",
  "moss-stone-ball.png",
  "slime-ball.png",
  "ice-crystal-ball.png",
  "spiked-ball.png",
  "cloud-ball.png",
] as const;

const POWER_SKIN_BY_TYPE: Record<PowerUpType, string> = {
  speed: "electric",
  jump: "cloud",
  heavy: "steel",
  shockwave: "spiked",
  shrink: "slime",
  ghost: "ice-crystal",
};

export function ballSkinTextureKey(ballSkin: BallSkin): string {
  return `ball-${ballSkin}`;
}

export function powerBallTextureKey(type: PowerUpType): string {
  return `power-ball-${POWER_SKIN_BY_TYPE[type]}`;
}

export function playerBallTextureKey(
  ballSkin: BallSkin,
  activeEffects: readonly ActivePowerUp[],
): string {
  const activePower = activeEffects[0];
  return activePower
    ? powerBallTextureKey(activePower.type)
    : ballSkinTextureKey(ballSkin);
}

export function regularBallAssetPath(file: string): string {
  return `/assets/balls/regular/${file}`;
}

export function powerBallAssetPaths(): ReadonlyArray<{
  key: string;
  path: string;
}> {
  return POWER_SKIN_FILES.map((file) => ({
    key: `power-ball-${file.replace(/-ball\.png$/, "").replace(/\.png$/, "")}`,
    path: `/assets/balls/power/${file}`,
  }));
}
