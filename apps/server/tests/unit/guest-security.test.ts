import test from "node:test";
import assert from "node:assert/strict";
import { GuestService } from "../../src/application/services/guest-service.js";
import type { GuestRepository } from "../../src/application/ports/guest-repository.js";
import { DomainError } from "../../src/domain/errors/domain-error.js";
import type { Guest } from "../../src/domain/entities/guest.js";
import {
  SecureRoomCodeGenerator,
  SecureTokenGenerator,
  Sha256TokenHasher,
  SystemClock,
  UuidGenerator,
} from "../../src/infrastructure/configuration/crypto-adapters.js";

class MemoryGuests implements GuestRepository {
  private readonly records = new Map<
    string,
    { guest: Guest; tokenHash: Buffer }
  >();
  storedHash: Buffer | null = null;
  async create(guest: Guest, tokenHash: Buffer): Promise<void> {
    this.storedHash = Buffer.from(tokenHash);
    this.records.set(tokenHash.toString("hex"), {
      guest,
      tokenHash: Buffer.from(tokenHash),
    });
  }
  async findByTokenHash(hash: Buffer) {
    return this.records.get(hash.toString("hex")) ?? null;
  }
  async update(guest: Guest): Promise<void> {
    for (const record of this.records.values())
      if (record.guest.id === guest.id) record.guest = guest;
  }
  async touch(): Promise<void> {}
}

test("guest token authenticates through its stored hash, never through a client guest id", async () => {
  const repository = new MemoryGuests();
  const service = new GuestService(
    repository,
    new SecureTokenGenerator(),
    new Sha256TokenHasher(),
    new UuidGenerator(),
    new SystemClock(),
  );
  const created = await service.create("  Guest   One ", "soccer");
  assert.match(created.token, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(repository.storedHash);
  assert.notEqual(repository.storedHash?.toString("base64url"), created.token);
  assert.equal(
    (await service.authenticate(created.token)).id,
    created.guest.id,
  );
  assert.equal(created.guest.ballSkin, "soccer");
  const updated = await service.updatePreferences(
    created.token,
    "Guest One",
    "basketball",
  );
  assert.equal(updated.ballSkin, "basketball");
  assert.equal(updated.color, "coral");
  await assert.rejects(
    () => service.authenticate("A".repeat(43)),
    (error: unknown) =>
      error instanceof DomainError && error.code === "INVALID_TOKEN",
  );
});

test("room codes use six unambiguous characters and no punctuation", () => {
  const generator = new SecureRoomCodeGenerator();
  for (let i = 0; i < 100; i++)
    assert.match(generator.createCode(), /^[A-HJ-NP-Z2-9]{6}$/);
});
