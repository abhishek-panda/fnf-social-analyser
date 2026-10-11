import type { Database } from '../db';
import type { ITokenRepository } from '../interfaces';
import type { InstagramToken } from '../types';

/**
 * Sole owner of all instagram_tokens DB queries.
 *
 * The table always holds at most one active row (the latest token).
 * On save(), the old row is deleted and a new one inserted — keeping the table lean.
 * Delete+insert rather than upsert ensures the refreshed_at and created_at
 * timestamps always reflect the true refresh event.
 */
export class TokenRepository implements ITokenRepository {
  constructor(private readonly db: Database) {}

  async getLatest(): Promise<InstagramToken | null> {
    const { rows } = await this.db.query<InstagramToken>(
      'SELECT * FROM instagram_tokens ORDER BY id DESC LIMIT 1'
    );
    return rows[0] ?? null;
  }

  async save(accessToken: string, expiresAt: Date | null): Promise<InstagramToken> {
    // Delete all existing rows so the table holds only the current token.
    // Simple and sufficient for a single-account POC.
    await this.db.query('DELETE FROM instagram_tokens');

    const { rows } = await this.db.query<InstagramToken>(
      `INSERT INTO instagram_tokens (access_token, expires_at, refreshed_at)
       VALUES ($1, $2, NOW())
       RETURNING *`,
      [accessToken, expiresAt]
    );
    return rows[0];
  }
}
