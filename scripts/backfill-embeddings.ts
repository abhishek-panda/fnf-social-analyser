/**
 * Backfill embeddings for all posts that have embedding IS NULL.
 *
 * Usage (from repo root):
 *   npx ts-node --project feed-collector/tsconfig.json scripts/backfill-embeddings.ts
 *
 * Requires:
 *   - Postgres running (docker compose up -d)
 *   - embedding-service running (cd embedding-service && uvicorn main:app --port 8000)
 *   - .env loaded (DB credentials + EMBEDDING_SERVICE_URL)
 */

import 'dotenv/config';
import { Pool } from 'pg';
import axios from 'axios';

// ── Config ────────────────────────────────────────────────────────────────────
const EMBEDDING_SERVICE_URL = process.env.EMBEDDING_SERVICE_URL ?? 'http://localhost:8000';
const MEDIA_PATH = process.env.MEDIA_PATH ?? './media';
const BATCH_SIZE = 10;

const db = new Pool({
  host:     process.env.DB_HOST     ?? 'localhost',
  port:     parseInt(process.env.DB_PORT ?? '5432', 10),
  database: process.env.DB_NAME     ?? 'fnf_social_analyser',
  user:     process.env.DB_USER     ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
});

// ── Types ─────────────────────────────────────────────────────────────────────
interface PostRow {
  id: string;
  platform: string;
  external_id: string;
  caption: string | null;
  image_path: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function fetchBatch(): Promise<PostRow[]> {
  const { rows } = await db.query<PostRow>(
    `SELECT id, platform, external_id, caption, image_path
     FROM posts
     WHERE id NOT IN (SELECT post_id FROM post_embeddings WHERE post_id IS NOT NULL)
       AND caption IS NOT NULL AND caption <> ''
       AND image_path ~ '\.(jpg|jpeg|png|webp)$'
     ORDER BY ingested_at ASC
     LIMIT $1`,
    [BATCH_SIZE]
  );
  return rows;
}

async function countRemaining(): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM posts
     WHERE id NOT IN (SELECT post_id FROM post_embeddings WHERE post_id IS NOT NULL)
       AND caption IS NOT NULL AND caption <> ''
       AND image_path ~ '\.(jpg|jpeg|png|webp)$'`
  );
  return parseInt(rows[0].count, 10);
}

interface EmbedResult {
  embedding: number[];
  cleanCaption: string;
  source: string;
  modelVersion: string;
}

async function embedPost(post: PostRow): Promise<EmbedResult | null> {
  const fullImagePath = `${MEDIA_PATH}/${post.platform}/${post.image_path}`;

  try {
    // Single call — caption cleaning + embedding handled internally by embedding-service
    const { data } = await axios.post<{ embedding: number[]; clean_caption: string; source: string; model_version: string }>(
      `${EMBEDDING_SERVICE_URL}/embed/combined`,
      { caption: post.caption, image_path: fullImagePath }
    );

    return {
      embedding: data.embedding,
      cleanCaption: data.clean_caption,
      source: data.source,
      modelVersion: data.model_version,
    };
  } catch (err) {
    const detail = axios.isAxiosError(err)
      ? `HTTP ${err.response?.status} — ${JSON.stringify(err.response?.data)}`
      : err instanceof Error ? err.message : String(err);
    console.error(`  ✗ embed failed for ${post.external_id}: ${detail}`);
    return null;
  }
}

async function saveEmbedding(
  postId: string,
  imagePath: string | null,
  cleanCaption: string,
  embedding: number[],
  embedSource: string,
  modelVersion: string
): Promise<void> {
  await db.query(
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

// ── Health check ──────────────────────────────────────────────────────────────
async function checkEmbeddingService(): Promise<void> {
  try {
    const { data } = await axios.get<{ status: string; device: string }>(
      `${EMBEDDING_SERVICE_URL}/health`
    );
    console.log(`✓ embedding-service ready — device: ${data.device}`);
  } catch {
    console.error(`✗ embedding-service not reachable at ${EMBEDDING_SERVICE_URL}`);
    console.error('  Start it with: cd embedding-service && uvicorn main:app --port 8000');
    process.exit(1);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log('═══════════════════════════════════════');
  console.log('  Embedding Backfill');
  console.log('═══════════════════════════════════════');

  await checkEmbeddingService();

  const total = await countRemaining();
  if (total === 0) {
    console.log('\n✓ All posts already have embeddings — nothing to do.');
    await db.end();
    return;
  }

  console.log(`
→ ${total} post(s) need embeddings
`);

  let processed = 0;
  let succeeded = 0;
  let skipped   = 0;
  let failed    = 0;

  while (true) {
    // Always fetch from offset 0 — the NOT IN subquery shrinks the eligible set
    // as embeddings are inserted, so previously processed posts are excluded automatically
    const batch = await fetchBatch();
    if (batch.length === 0) break;

    for (const post of batch) {
      processed++;
      process.stdout.write(`[${processed}/${total}] ${post.external_id} ... `);

      const result = await embedPost(post);

      if (!result) {
        console.log('skipped (embed failed)');
        skipped++;
        continue;
      }

      await saveEmbedding(post.id, post.image_path, result.cleanCaption, result.embedding, result.source, result.modelVersion);
      console.log(`✓ ${result.embedding.length} dims [${result.source}] caption: "${result.cleanCaption.slice(0, 50)}"`);
      succeeded++;
    }
  }

  console.log('\n═══════════════════════════════════════');
  console.log(`  Done`);
  console.log(`  Total:     ${processed}`);
  console.log(`  Embedded:  ${succeeded}`);
  console.log(`  Skipped:   ${skipped}`);
  console.log(`  Failed:    ${failed}`);
  console.log('═══════════════════════════════════════');

  await db.end();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
