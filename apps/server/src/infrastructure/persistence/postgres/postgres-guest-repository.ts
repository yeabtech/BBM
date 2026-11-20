import type { GuestRepository } from "../../../application/ports/guest-repository.js";
import { Guest } from "../../../domain/entities/guest.js";
import type { PostgresHealthRepository } from "./postgres-health-repository.js";

interface GuestRow extends Record<string, unknown> {
  guest_id: string;
  display_name: string;
  ball_color: string;
  ball_skin: string;
  created_at: Date;
  last_seen_at: Date;
  revoked_at: Date | null;
  token_hash: Buffer;
}

export class PostgresGuestRepository implements GuestRepository {
  constructor(private readonly database: PostgresHealthRepository) {}

  async create(guest: Guest, tokenHash: Buffer): Promise<void> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO guest_profiles (guest_id, display_name, ball_color, ball_skin, created_at, last_seen_at) VALUES ($1, $2, $3, $4, $5, $5)",
        [
          guest.id,
          guest.displayName,
          guest.color,
          guest.ballSkin,
          guest.createdAt,
        ],
      );
      await client.query(
        "INSERT INTO guest_tokens (guest_id, token_hash, created_at) VALUES ($1, $2, $3)",
        [guest.id, tokenHash, guest.createdAt],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async findByTokenHash(
    tokenHash: Buffer,
  ): Promise<{ guest: Guest; tokenHash: Buffer } | null> {
    const result = await this.database.query<GuestRow>(
      `SELECT g.guest_id, g.display_name, g.ball_color, g.ball_skin, g.created_at, g.last_seen_at,
              t.revoked_at, t.token_hash
       FROM guest_tokens t JOIN guest_profiles g ON g.guest_id = t.guest_id
       WHERE t.token_hash = $1 AND t.revoked_at IS NULL`,
      [tokenHash],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      guest: Guest.rehydrate({
        id: row.guest_id,
        displayName: row.display_name,
        color: row.ball_color,
        ballSkin: row.ball_skin,
        createdAt: row.created_at,
        lastSeenAt: row.last_seen_at,
        revokedAt: row.revoked_at,
      }),
      tokenHash: Buffer.from(row.token_hash),
    };
  }

  async update(guest: Guest): Promise<void> {
    await this.database.query(
      "UPDATE guest_profiles SET display_name = $2, ball_color = $3, ball_skin = $4, last_seen_at = $5 WHERE guest_id = $1",
      [
        guest.id,
        guest.displayName,
        guest.color,
        guest.ballSkin,
        guest.lastSeenAt,
      ],
    );
  }

  async touch(guestId: string, at: Date): Promise<void> {
    await this.database.query(
      "UPDATE guest_profiles SET last_seen_at = $2 WHERE guest_id = $1",
      [guestId, at],
    );
  }
}
