import type {
  GameplayPlayerSnapshot,
  RaceResultEntry,
} from "@bbm/shared-contracts";

export function countdownLabel(
  deadlineAt: string,
  serverOffsetMs: number,
  nowMs: number,
): string {
  const remaining = Date.parse(deadlineAt) - (nowMs + serverOffsetMs);
  return remaining > 0 ? String(Math.ceil(remaining / 1000)) : "GO!";
}

export function resultLabel(result: RaceResultEntry): string {
  const place = result.place === null ? "UNFINISHED" : `#${result.place}`;
  const time =
    result.finishTimeMs === null
      ? result.status === "disconnected"
        ? "DISCONNECTED"
        : "NO FINISH"
      : `${(result.finishTimeMs / 1000).toFixed(2)}s`;
  return `${place}  ${result.displayName}  ${time}`;
}

export function playerMotionState(
  player: Pick<
    GameplayPlayerSnapshot,
    | "respawning"
    | "finished"
    | "grounded"
    | "jumpsUsed"
    | "velocityX"
    | "velocityY"
  >,
): string {
  if (player.respawning) return "respawn";
  if (player.finished) return "finish";
  if (!player.grounded)
    return player.jumpsUsed > 1
      ? "double-jump"
      : player.velocityY < 0
        ? "jump"
        : "fall";
  return Math.abs(player.velocityX) > 30 ? "run" : "idle";
}
