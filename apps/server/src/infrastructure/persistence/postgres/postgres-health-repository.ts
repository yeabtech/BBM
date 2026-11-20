import { Pool, type PoolClient } from "pg";
import type { HealthRepository } from "../../../application/ports/health-repository.js";
import { logger } from "../../logging/logger.js";

export class PostgresHealthRepository implements HealthRepository {
  private readonly pool: Pool;
  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      connectionTimeoutMillis: 2000,
      max: 5,
    });
    this.pool.on("error", (error: Error & { code?: string }) => {
      logger.error(
        {
          errorName: error.name,
          ...(error.code ? { errorCode: error.code } : {}),
        },
        "Idle PostgreSQL connection failed",
      );
    });
  }
  async check(): Promise<void> {
    await this.pool.query("SELECT 1");
  }
  async close(): Promise<void> {
    await this.pool.end();
  }

  async connect(): Promise<PoolClient> {
    return this.pool.connect();
  }
  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ) {
    return this.pool.query<T>(sql, values);
  }
}
