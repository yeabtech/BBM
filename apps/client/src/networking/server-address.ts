export function parseServerAddress(host: string, port: string): string {
  const normalizedHost = host.trim();
  if (!normalizedHost || /[\s/@?#]/.test(normalizedHost))
    throw new Error("Enter a valid host name or IP address.");
  const parsedPort = Number(port);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535)
    throw new Error("Enter a port from 1 to 65535.");
  let parsed: URL;
  try {
    const urlHost = normalizedHost.includes(":")
      ? `[${normalizedHost.replace(/^\[|\]$/g, "")}]`
      : normalizedHost;
    parsed = new URL(`http://${urlHost}:${parsedPort}`);
  } catch {
    throw new Error("Enter a valid host name or IP address.");
  }
  if (!parsed.hostname || parsed.username || parsed.password)
    throw new Error("Enter a valid host name or IP address.");
  return parsed.origin;
}

export function serverAddressParts(baseUrl: string): {
  host: string;
  port: string;
} {
  const parsed = new URL(baseUrl);
  return {
    host: parsed.hostname.replace(/^\[|\]$/g, ""),
    port: parsed.port || (parsed.protocol === "https:" ? "443" : "80"),
  };
}

export async function checkServerHealth(baseUrl: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/health/db`, {
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError")
      throw new Error(
        "The host did not respond before the connection timed out. Check the address, port, and firewall.",
      );
    if (error instanceof TypeError)
      throw new Error(
        "Could not reach that host or its origin was rejected. Check the address, port, same-LAN connection, CLIENT_ORIGINS, and Windows Firewall.",
      );
    throw error;
  }

  if (response.status === 503)
    throw new Error(
      "The host server is running, but its database is unavailable.",
    );
  if (!response.ok)
    throw new Error(
      "The host server rejected the connection. Check its client origin settings.",
    );
}

export async function isBbmServer(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/lan-info`, {
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) return false;
    const value: unknown = await response.json();
    return (
      typeof value === "object" &&
      value !== null &&
      typeof (value as Record<string, unknown>).enabled === "boolean" &&
      Number.isInteger((value as Record<string, unknown>).port) &&
      Array.isArray((value as Record<string, unknown>).addresses) &&
      typeof (value as Record<string, unknown>).clientServed === "boolean" &&
      typeof (value as Record<string, unknown>).canHost === "boolean"
    );
  } catch {
    // A failed probe means the client must ask the user to select a server.
    return false;
  }
}
