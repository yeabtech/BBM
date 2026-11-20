import type { HealthRepository } from "../ports/health-repository.js";

export class HealthService {
  constructor(private readonly database: HealthRepository | null) {}
  async databaseAvailable(): Promise<boolean> {
    if (!this.database) return false;
    try {
      await this.database.check();
      return true;
    } catch {
      return false;
    }
  }
  async close(): Promise<void> {
    await this.database?.close();
  }
}
