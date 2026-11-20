import type { IncomingMessage } from "node:http";

export interface ClientOriginPolicy {
  allowedOrigins: readonly string[];
  production: boolean;
  /** Whether the HTTP app is also serving the client bundle from this server. */
  servesClient: boolean;
}

/**
 * Decides whether a browser origin may use the HTTP API and the WebSocket.
 *
 * - Exact `allowedOrigins` entries are always accepted.
 * - In development, a loopback or same-host client on the Vite dev ports
 *   (5173-5180) is accepted when its hostname matches the request host.
 * - When this server serves the client bundle, a same-origin client is
 *   accepted: its origin hostname must equal the hostname the browser used to
 *   reach this server, and its port must be the default HTTP port or this
 *   server's port. Hotspot players open `http://<host-ip>:<port>/` without any
 *   extra origin configuration, while unrelated sites stay rejected.
 */
export function isAllowedClientOrigin(
  origin: string,
  requestHostname: string,
  requestPort: number | null,
  policy: ClientOriginPolicy,
): boolean {
  if (policy.allowedOrigins.includes(origin)) return true;
  if (policy.production) return false;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:") return false;
  const clientHost = normalizeHostname(parsed.hostname);
  const serverHost = normalizeHostname(requestHostname);
  if (!clientHost || clientHost !== serverHost) return false;
  // Browsers omit `:80` from an origin, so compare the effective port that the
  // server's Host header must carry to serve the client itself.
  const clientPort = Number(parsed.port || "80");
  if (clientPort >= 5173 && clientPort <= 5180) return true;
  return policy.servesClient && clientPort === serverPort(requestPort);
}

/** Hostname of the request's Host header, without the port. */
export function requestHostname(request: IncomingMessage): string {
  return normalizeHostname(splitHostHeader(request.headers.host).hostname);
}

/** Port from the request's Host header, or null when it carries none. */
export function requestPort(request: IncomingMessage): number | null {
  const { port } = splitHostHeader(request.headers.host);
  return port === "" ? null : Number(port);
}

function splitHostHeader(host: string | undefined): {
  hostname: string;
  port: string;
} {
  const value = (host ?? "").trim();
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    if (end === -1) return { hostname: value, port: "" };
    return {
      hostname: value.slice(0, end + 1),
      port: value.slice(end + 1).replace(/^:/, ""),
    };
  }
  const separator = value.lastIndexOf(":");
  if (separator === -1) return { hostname: value, port: "" };
  return {
    hostname: value.slice(0, separator),
    port: value.slice(separator + 1),
  };
}

function serverPort(requestPort: number | null): number {
  return requestPort ?? 80;
}

function normalizeHostname(hostname: string): string {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
}
