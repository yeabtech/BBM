import type { RaceSessionSnapshot } from "../../domain/entities/race-session.js";
import type { RaceResultEntry } from "@bbm/shared-contracts";
import type {
  RaceRepository,
  RaceTransition,
} from "../ports/race-repository.js";
import type { Clock, IdGenerator } from "../ports/security-ports.js";

export const DEFAULT_RACE_COUNTDOWN_MS = 3_000;
export const DEFAULT_RACE_TIMEOUT_MS = 120_000;

export interface StartedRace {
  race: RaceSessionSnapshot;
  created: boolean;
}

export class RaceService {
  constructor(
    private readonly races: RaceRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly countdownMs = DEFAULT_RACE_COUNTDOWN_MS,
    private readonly timeoutMs = DEFAULT_RACE_TIMEOUT_MS,
  ) {}

  async start(guestId: string, connectionId: string): Promise<StartedRace> {
    const result = await this.races.startForHost({
      guestId,
      connectionId,
      raceId: this.ids.createId(),
      now: this.clock.now(),
      countdownMs: this.countdownMs,
    });
    return {
      race: result.race.toSnapshot(this.clock.now()),
      created: result.created,
    };
  }

  async currentForGuest(guestId: string): Promise<RaceSessionSnapshot | null> {
    return (
      (await this.races.findCurrentForGuest(guestId))?.toSnapshot(
        this.clock.now(),
      ) ?? null
    );
  }

  async currentForRoom(roomId: string): Promise<RaceSessionSnapshot | null> {
    return (
      (await this.races.findCurrentForRoom(roomId))?.toSnapshot(
        this.clock.now(),
      ) ?? null
    );
  }

  async hasActiveRaces(): Promise<boolean> {
    return this.races.hasActiveRaces();
  }

  async advanceDue(): Promise<RaceTransition[]> {
    return this.races.advanceDue(this.clock.now(), this.timeoutMs);
  }

  async cancelForRoom(
    roomId: string,
    reason: "HostLeft" | "RoomExpired",
  ): Promise<RaceSessionSnapshot | null> {
    const race = await this.races.cancelForRoom(
      roomId,
      reason,
      this.clock.now(),
    );
    return race?.toSnapshot(this.clock.now()) ?? null;
  }

  async recoverAfterRestart(): Promise<RaceSessionSnapshot[]> {
    return (await this.races.cancelActiveOnRestart(this.clock.now())).map(
      (race) => race.toSnapshot(this.clock.now()),
    );
  }

  async saveResults(
    raceId: string,
    results: readonly RaceResultEntry[],
    finishRace: boolean,
  ): Promise<void> {
    await this.races.persistResults(
      raceId,
      this.clock.now(),
      results,
      finishRace,
    );
  }

  async results(raceId: string): Promise<RaceResultEntry[] | null> {
    return this.races.findResults(raceId);
  }
}
