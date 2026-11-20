import type { Server } from "node:http";
import { lanAddresses } from "../../infrastructure/networking/lan-addresses.js";
import { logger } from "../../infrastructure/logging/logger.js";
import type { HostingControl } from "./app.js";

/**
 * Lets the lobby on the host computer start LAN hosting without editing `.env`.
 *
 * The server keeps listening on the loopback address until the host explicitly
 * asks for LAN hosting from the UI. Enabling rebinds the same server instance to
 * all interfaces on the same port, so the HTTP API, the WebSocket gateway and
 * the served client all move together. There is no second game server.
 */
export function createLanHosting(
  server: Server,
  port: number,
  initialHost: string,
): HostingControl {
  let host = initialHost;
  let pending: Promise<void> | null = null;

  const enabled = () =>
    !["127.0.0.1", "::1", "localhost"].includes(host.toLowerCase());

  async function rebindTo(target: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off("listening", onListening);
        reject(error);
      };
      // `listen` while an existing handle is still closing would be a no-op.
      if (server.listening) server.close();
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, target);
    });
    host = target;
    // The listener now accepts connections on every interface. Only now release
    // the sockets held by the loopback listener, so this HTTP response can be
    // delivered and clients can reconnect on their own.
    setImmediate(() => server.closeAllConnections?.());
    logger.info(
      {
        host: target,
        port,
        lanAddresses: lanAddresses().map((entry) => entry.address),
      },
      "BBM hosting enabled from the lobby",
    );
  }

  return {
    enabled,
    enable(): Promise<void> {
      if (enabled() || host === "0.0.0.0" || host === "::")
        return Promise.resolve();
      if (!pending) {
        pending = rebindTo("0.0.0.0").finally(() => {
          pending = null;
        });
      }
      return pending;
    },
  };
}
