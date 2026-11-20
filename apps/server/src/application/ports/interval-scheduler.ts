export interface ScheduledInterval {
  cancel(): Promise<void>;
}

export interface IntervalScheduler {
  every(
    intervalMs: number,
    task: () => void | Promise<void>,
  ): ScheduledInterval;
}
