import test from "node:test";
import assert from "node:assert/strict";
import { PostgresHealthRepository } from "../../src/infrastructure/persistence/postgres/postgres-health-repository.js";
import { loadWorkspaceEnv } from "../../src/infrastructure/configuration/load-env.js";

loadWorkspaceEnv();

test(
  "database health executes SELECT 1 against configured PostgreSQL",
  {
    skip:
      !process.env.DATABASE_URL &&
      "Set DATABASE_URL to run PostgreSQL integration test",
  },
  async () => {
    const repository = new PostgresHealthRepository(process.env.DATABASE_URL!);
    try {
      await repository.check();
      assert.ok(true);
    } finally {
      await repository.close();
    }
  },
);
