import assert from "node:assert/strict";
import test from "node:test";
import { lanIpv4Addresses } from "../../src/infrastructure/networking/lan-addresses.js";

test("LAN address selection filters loopback, link-local, public, and IPv6 entries", () => {
  const interfaces = {
    WiFi: [
      { address: "127.0.0.1", family: "IPv4", internal: true },
      { address: "169.254.1.3", family: "IPv4", internal: false },
      { address: "8.8.8.8", family: "IPv4", internal: false },
      { address: "192.168.1.20", family: "IPv4", internal: false },
      { address: "fe80::1", family: "IPv6", internal: false },
    ],
    Ethernet: [
      { address: "10.2.3.4", family: "IPv4", internal: false },
      { address: "172.20.1.2", family: "IPv4", internal: false },
      { address: "192.168.1.20", family: "IPv4", internal: false },
    ],
  } as never;
  assert.deepEqual(lanIpv4Addresses(interfaces), [
    "192.168.1.20",
    "10.2.3.4",
    "172.20.1.2",
  ]);
});

test("LAN address selection returns no address when none is usable", () => {
  assert.deepEqual(
    lanIpv4Addresses({
      Loopback: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
    } as never),
    [],
  );
});
