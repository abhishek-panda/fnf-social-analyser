import { Worker } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { EMBED_QUEUE_NAME, type EmbedJobData } from './embedQueue';
import type { IPostRepository } from '../interfaces';
import type { EmbeddingService } from '../services/EmbeddingService';
import type { ImageDownloaderService } from '../services/ImageDownloaderService';
import type { Platform } from '../types';

/**
 * BullMQ worker — consumes embed jobs from Redis queue.
 *
 * concurrency: 1 ensures jobs are processed sequentially,
 * preventing concurrent Ollama/FashionCLIP calls that cause socket hang up.
 *
 * Jobs persist in Redis across restarts — no posts are lost if the app crashes.
 * Failed jobs are retried automatically with exponential backoff.
 */
export class EmbeddingWorker {
  private readonly worker: Worker<EmbedJobData>;

  constructor(
    connection: ConnectionOptions,
    private readonly postRepo: IPostRepository,
    private readonly embeddingService: EmbeddingService,
    private readonly imageDownloader: ImageDownloaderService
  ) {
    this.worker = new Worker<EmbedJobData>(
      EMBED_QUEUE_NAME,
      (job) => this.process(job.data),
      {
        connection,
        concurrency: 1,  // sequential — one embed at a time (Ollama is single-threaded)
      }
    );

    this.worker.on('completed', (job) => {
      console.log(`[EmbeddingWorker] ✓ job ${job.id} — post ${job.data.externalId}`);
    });

    this.worker.on('failed', (job, err) => {
      console.error(`[EmbeddingWorker] ✗ job ${job?.id} failed (attempt ${job?.attemptsMade}):`, err.message);
    });

    console.log('[EmbeddingWorker] Listening on Redis queue (concurrency: 1)');
  }

  private async process(data: EmbedJobData): Promise<void> {
    const { postId, platform, externalId, caption, imagePath } = data;

    const fullImagePath = imagePath
      ? this.imageDownloader.buildFullPath(platform as Platform, imagePath)
      : null;

    // Step 1 — embed (caption cleaning happens inside embedding-service)
    const embedResult = await this.embeddingService.embed(caption, fullImagePath);
    if (!embedResult) {
      console.warn(`[EmbeddingWorker] No embedding returned for post ${externalId}`);
      return;
    }

    // Step 2 — save to post_embeddings
    await this.postRepo.savePostEmbedding(
      postId,
      imagePath,
      embedResult.cleanCaption,
      embedResult.embedding,
      embedResult.source,
      embedResult.modelVersion
    );

    console.log(`[EmbeddingWorker] Embedded post ${externalId} (${embedResult.embedding.length} dims [${embedResult.source}])`);
  }

  async close(): Promise<void> {
    await this.worker.close();
  }
}
