import { loadConfig } from "./infrastructure/configuration/config.js";
import { loadWorkspaceEnv } from "./infrastructure/configuration/load-env.js";
import { logger } from "./infrastructure/logging/logger.js";
import { compose } from "./composition/create-server.js";
import { gracefullyCloseServer } from "./infrastructure/runtime/graceful-shutdown.js";

loadWorkspaceEnv();
const config = loadConfig(process.env);
const { server, health, rooms, races, gateway } = compose(config);
if (config.databaseRequired && !(await health.databaseAvailable())) {
  logger.fatal("Required database is unavailable");
  await health.close();
  process.exit(1);
}
if (races) await races.recoverAfterRestart();
if (rooms) await rooms.closeRoomsOnStartup();
server.listen(config.port, config.host, () =>
  logger.info(
    {
      host: config.host,
      port: config.port,
      databaseConfigured: Boolean(config.databaseUrl),
      lobbyEnabled: Boolean(rooms),
    },
    "BBM API listening",
  ),
);
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Shutting down");
  const timeout = setTimeout(() => {
    logger.error("Shutdown timed out");
    process.exit(1);
  }, 10_000);
  timeout.unref();
  try {
    await gracefullyCloseServer(server, gateway, health);
  } catch (error) {
    logger.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Graceful shutdown failed",
    );
    process.exitCode = 1;
  }
  clearTimeout(timeout);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
