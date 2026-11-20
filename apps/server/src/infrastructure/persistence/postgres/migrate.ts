import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { loadWorkspaceEnv } from "../../configuration/load-env.js";

loadWorkspaceEnv();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required for migrations");
  process.exit(1);
}
const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 3000 });
const dir = join(dirname(fileURLToPath(import.meta.url)), "migrations");
try {
  await pool.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const files = (await readdir(dir))
    .filter((file) => /^\d+_[\w-]+\.sql$/.test(file))
    .sort();
  const rows = await pool.query<{ version: string }>(
    "SELECT version FROM schema_migrations ORDER BY version",
  );
  const applied = new Set(rows.rows.map((row) => row.version));
  if (process.argv[2] === "status") {
    for (const file of files)
      console.log(
        `${applied.has(file.slice(0, -4)) ? "applied" : "pending"} ${file}`,
      );
  } else if (process.argv[2] === "up") {
    for (const file of files) {
      const version = file.slice(0, -4);
      if (applied.has(version)) continue;
      await pool.query("BEGIN");
      try {
        await pool.query(await readFile(join(dir, file), "utf8"));
        await pool.query("INSERT INTO schema_migrations(version) VALUES ($1)", [
          version,
        ]);
        await pool.query("COMMIT");
        console.log(`applied ${file}`);
      } catch (error) {
        await pool.query("ROLLBACK");
        throw error;
      }
    }
  } else {
    console.error("Usage: migrate.ts up|status");
    process.exitCode = 1;
  }
} catch (error) {
  console.error(
    `Migration command failed: ${error instanceof Error ? error.message : "unknown error"}`,
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
