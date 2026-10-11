import { Pool, PoolClient, QueryResult } from 'pg';
import type { DbConfig } from '../config';

const SCHEMA_SQL = `
  CREATE EXTENSION IF NOT EXISTS "pgcrypto";
  CREATE EXTENSION IF NOT EXISTS "vector";

  CREATE TABLE IF NOT EXISTS products (
    tpnb          TEXT        PRIMARY KEY,
    title         TEXT        NOT NULL,
    description   TEXT,
    colour        TEXT,
    category      TEXT,
    image_url     TEXT,
    search_vector TSVECTOR,
    synced_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_products_search ON products USING GIN (search_vector);

  CREATE OR REPLACE FUNCTION products_search_vector_update() RETURNS TRIGGER AS $$
  BEGIN
    NEW.search_vector :=
      setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B') ||
      setweight(to_tsvector('english', coalesce(NEW.colour, '')), 'C') ||
      setweight(to_tsvector('english', coalesce(NEW.category, '')), 'C');
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS products_search_vector_trigger ON products;
  CREATE TRIGGER products_search_vector_trigger
    BEFORE INSERT OR UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION products_search_vector_update();

  CREATE TABLE IF NOT EXISTS posts (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    platform         TEXT        NOT NULL,
    external_id      TEXT        NOT NULL,
    url              TEXT        NOT NULL,
    image_path       TEXT,
    caption          TEXT,
    author_handle    TEXT,
    author_url       TEXT,
    published_at     TIMESTAMPTZ,
    product_id       TEXT,
    product_url      TEXT,
    hidden           BOOLEAN     NOT NULL DEFAULT false,
    ingested_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (platform, external_id)
  );

  -- Legacy column cleanup for existing deployments
  ALTER TABLE posts DROP COLUMN IF EXISTS thumbnail_url;
  ALTER TABLE posts DROP COLUMN IF EXISTS raw_metadata;
  ALTER TABLE posts DROP COLUMN IF EXISTS embedding;
  -- New columns for existing deployments
  ALTER TABLE posts ADD COLUMN IF NOT EXISTS product_id  TEXT;
  ALTER TABLE posts ADD COLUMN IF NOT EXISTS product_url TEXT;

  CREATE INDEX IF NOT EXISTS idx_posts_platform ON posts (platform);

  CREATE TABLE IF NOT EXISTS post_embeddings (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id       UUID        REFERENCES posts(id) ON DELETE SET NULL,
    image_path    TEXT,
    clean_caption TEXT,
    embedding     VECTOR(768),
    embed_source  TEXT        NOT NULL,
    model_version TEXT        NOT NULL DEFAULT 'unknown',
    embedded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (post_id)
  );

  CREATE INDEX IF NOT EXISTS idx_post_embeddings_embedding
    ON post_embeddings USING hnsw (embedding vector_cosine_ops);

  CREATE INDEX IF NOT EXISTS idx_post_embeddings_post_id
    ON post_embeddings (post_id);

  CREATE TABLE IF NOT EXISTS post_product_links (
    id               UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id          UUID  NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    tpnb             TEXT  NOT NULL REFERENCES products(tpnb),
    confidence_score FLOAT NOT NULL,
    matched_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (post_id, tpnb)
  );

  CREATE INDEX IF NOT EXISTS idx_ppl_tpnb_confidence ON post_product_links (tpnb, confidence_score DESC);

  CREATE TABLE IF NOT EXISTS hashtag_tpnb_map (
    hashtag TEXT NOT NULL,
    tpnb    TEXT NOT NULL REFERENCES products(tpnb),
    PRIMARY KEY (hashtag, tpnb)
  );

  CREATE TABLE IF NOT EXISTS instagram_tokens (
    id           SERIAL      PRIMARY KEY,
    access_token TEXT        NOT NULL,
    expires_at   TIMESTAMPTZ,
    refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

/** Wraps pg Pool with a clean injectable interface. */
export class Database {
  private readonly pool: Pool;

  constructor(config: DbConfig) {
    this.pool = new Pool({
      host:     config.host,
      port:     config.port,
      database: config.database,
      user:     config.user,
      password: config.password,
    });

    this.pool.on('error', (err: Error) => {
      console.error('[DB] Unexpected client error:', err.message);
    });
  }

  /**
   * Creates all tables if they don't exist. Safe to call on every startup —
   * existing tables and data are never modified.
   */
  async initialise(): Promise<void> {
    await this.pool.query(SCHEMA_SQL);
    console.log('[DB] Schema initialised');
  }

  async query<T extends object = Record<string, unknown>>(
    text: string,
    params?: unknown[]
  ): Promise<QueryResult<T>> {
    const start = Date.now();
    const result = await this.pool.query<T>(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV !== 'test') {
      console.debug(`[DB] ${duration}ms — rows: ${result.rowCount}`);
    }
    return result;
  }

  async getClient(): Promise<PoolClient> {
    return this.pool.connect();
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
