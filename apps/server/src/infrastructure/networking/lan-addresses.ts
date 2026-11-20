import { networkInterfaces } from "node:os";

export interface LanAddress {
  address: string;
  /** Network adapter name, so the host can tell Wi-Fi from virtual adapters. */
  interface: string;
  /** Lower is a better default for sharing with other devices. */
  priority: number;
}

const VIRTUAL_ADAPTER =
  /vmware|virtualbox|vbox|hyper-v|vethernet|docker|wsl|loopback|tap|tun|vpn|bluetooth|zerotier|tailscale|radmin/i;

/**
 * Private IPv4 addresses other devices may use to reach this computer.
 *
 * Ordered so the adapter people actually connect through comes first: the
 * Windows mobile-hotspot address (192.168.137.x), then Wi-Fi, then other LAN
 * adapters, with virtual/VPN adapters last. This machine's hotspot address is
 * valid even though no interface reports the usual hotspot prefix.
 */
export function lanAddresses(
  interfaces: ReturnType<typeof networkInterfaces> = networkInterfaces(),
): LanAddress[] {
  const found = new Map<string, LanAddress>();
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (
        entry.family !== "IPv4" ||
        entry.internal ||
        !isPrivateIpv4(entry.address) ||
        found.has(entry.address)
      )
        continue;
      found.set(entry.address, {
        address: entry.address,
        interface: name,
        priority: addressPriority(entry.address, name),
      });
    }
  }
  return [...found.values()].sort(
    (left, right) =>
      left.priority - right.priority ||
      left.address.localeCompare(right.address),
  );
}

/** Addresses only, in sharing order. */
export function lanIpv4Addresses(
  interfaces: ReturnType<typeof networkInterfaces> = networkInterfaces(),
): string[] {
  return lanAddresses(interfaces).map((entry) => entry.address);
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  )
    return false;
  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

function addressPriority(address: string, name: string): number {
  if (VIRTUAL_ADAPTER.test(name)) return 3;
  // Windows Internet Connection Sharing hotspot gateway.
  if (address.startsWith("192.168.137.")) return 0;
  if (/wi-?fi|wireless|wlan/i.test(name)) return 1;
  return 2;
}
