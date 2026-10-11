import type { Pool } from 'pg';
import type { IDirectMatchRepository } from '../interfaces';
import type { PostRow } from '../types';

/** Tier 1 — exact match via product_tags metadata or caption URL. */
export class DirectMatchRepository implements IDirectMatchRepository {
  constructor(private readonly pool: Pool) {}

  /** Posts where product_id matches the given tpnb. */
  async findByProductTag(tpnb: string): Promise<PostRow[]> {
    const { rows } = await this.pool.query<PostRow>(
      `SELECT
         id,
         platform,
         external_id,
         url,
         caption,
         image_path,
         published_at
       FROM posts
       WHERE hidden = false
         AND product_id = $1`,
      [tpnb]
    );
    return rows;
  }

  /** Posts whose caption contains the product URL (case-insensitive). */
  async findByProductUrl(productUrl: string): Promise<PostRow[]> {
    const { rows } = await this.pool.query<PostRow>(
      `SELECT
         id,
         platform,
         external_id,
         url,
         caption,
         image_path,
         published_at
       FROM posts
       WHERE hidden = false
         AND caption ILIKE $1`,
      [`%${productUrl}%`]
    );
    return rows;
  }
}
