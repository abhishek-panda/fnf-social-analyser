import type { Database } from '../db';
import type { IPostRepository } from '../interfaces';
import type {
  Post,
  NewPost,
  PostProductLink,
  SocialPostItem,
  QueryOptions,
  Platform,
} from '../types';

/** Sole owner of all post-related DB queries. */
export class PostRepository implements IPostRepository {
  constructor(private readonly db: Database) {}

  async upsert(post: NewPost): Promise<Post> {
    const { rows } = await this.db.query<Post>(
      `INSERT INTO posts
         (platform, external_id, url, caption, author_handle, author_url, published_at, product_id, product_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (platform, external_id)
         DO UPDATE SET
           caption      = EXCLUDED.caption,
           published_at = EXCLUDED.published_at,
           product_id   = EXCLUDED.product_id,
           product_url  = EXCLUDED.product_url,
           ingested_at  = NOW()
       RETURNING *`,
      [
        post.platform,
        post.external_id,
        post.url,
        post.caption,
        post.author_handle,
        post.author_url,
        post.published_at,
        post.product_id ?? null,
        post.product_url ?? null,
      ]
    );
    return rows[0];
  }

  async updateImagePath(postId: string, imagePath: string): Promise<void> {
    await this.db.query(
      'UPDATE posts SET image_path = $1 WHERE id = $2',
      [imagePath, postId]
    );
  }

  async savePostEmbedding(
    postId: string,
    imagePath: string | null,
    cleanCaption: string,
    embedding: number[],
    embedSource: string,
    modelVersion: string
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO post_embeddings (post_id, image_path, clean_caption, embedding, embed_source, model_version)
       VALUES ($1, $2, $3, $4::vector, $5, $6)
       ON CONFLICT (post_id) DO UPDATE SET
         image_path    = EXCLUDED.image_path,
         clean_caption = EXCLUDED.clean_caption,
         embedding     = EXCLUDED.embedding,
         embed_source  = EXCLUDED.embed_source,
         model_version = EXCLUDED.model_version,
         embedded_at   = NOW()`,
      [postId, imagePath, cleanCaption, `[${embedding.join(',')}]`, embedSource, modelVersion]
    );
  }

  async findByTpnb(tpnb: string, options: QueryOptions = {}): Promise<SocialPostItem[]> {
    const { limit = 10, platform } = options;
    const params: unknown[] = [tpnb];

    let sql = `
      SELECT
        p.id,
        p.platform,
        p.url,
        p.image_path,
        p.caption,
        p.author_handle,
        p.author_url,
        ppl.confidence_score
      FROM post_product_links ppl
      JOIN posts p ON p.id = ppl.post_id
      WHERE ppl.tpnb = $1
        AND p.hidden = false
    `;

    if (platform) {
      params.push(platform as Platform);
      sql += ` AND p.platform = $${params.length}`;
    }

    sql += ` ORDER BY ppl.confidence_score DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const { rows } = await this.db.query<SocialPostItem>(sql, params);
    return rows;
  }

  async findById(id: string): Promise<Post | null> {
    const { rows } = await this.db.query<Post>(
      'SELECT * FROM posts WHERE id = $1 AND hidden = false',
      [id]
    );
    return rows[0] ?? null;
  }

  async hide(id: string): Promise<boolean> {
    const { rows } = await this.db.query<{ id: string }>(
      'UPDATE posts SET hidden = true WHERE id = $1 RETURNING id',
      [id]
    );
    return rows.length > 0;
  }

  async saveLinks(
    postId: string,
    links: Array<{ tpnb: string; confidence_score: number }>
  ): Promise<PostProductLink[]> {
    if (links.length === 0) return [];

    const tpnbs = links.map((l) => l.tpnb);
    const scores = links.map((l) => l.confidence_score);

    const { rows } = await this.db.query<PostProductLink>(
      `INSERT INTO post_product_links (post_id, tpnb, confidence_score)
       SELECT $1, unnest($2::text[]), unnest($3::float[])
       ON CONFLICT (post_id, tpnb)
         DO UPDATE SET confidence_score = EXCLUDED.confidence_score, matched_at = NOW()
       RETURNING *`,
      [postId, tpnbs, scores]
    );
    return rows;
  }
}
