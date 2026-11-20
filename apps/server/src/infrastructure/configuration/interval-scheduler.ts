import type {
  IntervalScheduler,
  ScheduledInterval,
} from "../../application/ports/interval-scheduler.js";

export class SystemIntervalScheduler implements IntervalScheduler {
  every(
    intervalMs: number,
    task: () => void | Promise<void>,
  ): ScheduledInterval {
    let inFlight = Promise.resolve();
    const timer = setInterval(() => {
      inFlight = inFlight.then(task).then(
        () => undefined,
        () => undefined,
      );
    }, intervalMs);
    timer.unref();
    return {
      cancel: async () => {
        clearInterval(timer);
        await inFlight;
      },
    };
  }
}
