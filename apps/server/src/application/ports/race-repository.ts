import type {
  RaceCancellationReason,
  RaceSession,
  RaceSessionSnapshot,
} from "../../domain/entities/race-session.js";
import type { RaceResultEntry } from "@bbm/shared-contracts";

export interface RaceStartResult {
  race: RaceSession;
  created: boolean;
}

export interface RaceTransition {
  snapshot: RaceSessionSnapshot;
  state: "InProgress" | "Cancelled";
}

export interface RaceRepository {
  startForHost(input: {
    guestId: string;
    connectionId: string;
    raceId: string;
    now: Date;
    countdownMs: number;
  }): Promise<RaceStartResult>;
  findCurrentForGuest(guestId: string): Promise<RaceSession | null>;
  findCurrentForRoom(roomId: string): Promise<RaceSession | null>;
  hasActiveRaces(): Promise<boolean>;
  advanceDue(now: Date, timeoutMs: number): Promise<RaceTransition[]>;
  cancelForRoom(
    roomId: string,
    reason: RaceCancellationReason,
    now: Date,
  ): Promise<RaceSession | null>;
  cancelActiveOnRestart(now: Date): Promise<RaceSession[]>;
  persistResults(
    raceId: string,
    finishedAt: Date,
    results: readonly RaceResultEntry[],
    finishRace: boolean,
  ): Promise<void>;
  findResults(raceId: string): Promise<RaceResultEntry[] | null>;
}
