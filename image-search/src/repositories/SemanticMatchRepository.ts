import type { Pool } from 'pg';
import type { ISemanticMatchRepository } from '../interfaces';
import type { SemanticResult } from '../types';

/** Tier 2 — pgvector cosine similarity against FashionCLIP embeddings. */
export class SemanticMatchRepository implements ISemanticMatchRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Finds posts whose stored embedding is within `threshold` cosine distance
   * of the query `embedding`, ordered by similarity descending.
   */
  async findSimilar(
    embedding: number[],
    limit: number,
    threshold: number
  ): Promise<SemanticResult[]> {
    const vectorLiteral = `[${embedding.join(',')}]`;

    const { rows } = await this.pool.query<SemanticResult>(
      `SELECT
         p.id             AS "postId",
         p.platform,
         p.url,
         p.caption,
         p.image_path,
         p.published_at,
         pe.clean_caption,
         1 - (pe.embedding <=> $1::vector) AS score
       FROM post_embeddings pe
       JOIN posts p ON p.id = pe.post_id
       WHERE p.hidden = false
         AND pe.embedding IS NOT NULL
         AND 1 - (pe.embedding <=> $1::vector) >= $2
       ORDER BY score DESC
       LIMIT $3`,
      [vectorLiteral, threshold, limit]
    );
    return rows;
  }
}
