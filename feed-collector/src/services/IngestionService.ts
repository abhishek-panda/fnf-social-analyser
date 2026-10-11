import type { Queue } from 'bullmq';
import type { IIngestionService, ISocialPlatformClient, IPostRepository } from '../interfaces';
import type { InstagramClient } from '../platforms/InstagramClient';
import type { ImageDownloaderService } from './ImageDownloaderService';
import type { EmbedJobData } from '../queue/embedQueue';

/**
 * Orchestrates one ingestion cycle: fetch → upsert → download image → enqueue embed job.
 *
 * Embedding, caption cleaning, and product matching are handled asynchronously
 * by EmbeddingWorker consuming the BullMQ Redis queue.
 * Jobs persist across restarts — no posts are lost on crash.
 */
export class IngestionService implements IIngestionService {
  constructor(
    private readonly platformClient: ISocialPlatformClient,
    private readonly postRepo: IPostRepository,
    private readonly imageDownloader: ImageDownloaderService,
    private readonly embedQueue: Queue<EmbedJobData>
  ) {}

  async runCycle(mediaType: 'recent_media' | 'top_media' = 'recent_media'): Promise<{ total: number; matched: number }> {
    console.log(
      `[IngestionService] Starting ${mediaType} ingestion for platform: ${this.platformClient.platform}`
    );

    let total = 0;

    const stream = this.getStream(mediaType);

    for await (const { post: newPost, mediaUrl } of stream) {
      total++;
      try {
        const savedPost = await this.postRepo.upsert(newPost);

        // Download image
        if (!savedPost.image_path) {
          const filename = await this.imageDownloader.download(
            mediaUrl,
            savedPost.platform,
            savedPost.external_id
          );
          if (filename) {
            await this.postRepo.updateImagePath(savedPost.id, filename);
            savedPost.image_path = filename;
          }
        }

        // Only enqueue posts with a static image and caption — skip videos
        const isEmbeddable = savedPost.caption?.trim() &&
          savedPost.image_path &&
          /\.(jpg|jpeg|png|webp)$/i.test(savedPost.image_path);

        if (isEmbeddable) {
          await this.embedQueue.add('embed', {
            postId: savedPost.id,
            platform: savedPost.platform,
            externalId: savedPost.external_id,
            caption: savedPost.caption,
            imagePath: savedPost.image_path,
          });
          console.log(`[IngestionService] Post ${savedPost.external_id} queued for embedding`);
        }

      } catch (err) {
        console.error(
          `[IngestionService] Error processing post ${newPost.external_id}:`,
          err instanceof Error ? err.message : err
        );
      }
    }

    console.log(`[IngestionService] Cycle complete. Posts ingested: ${total}`);
    return { total, matched: 0 };  // matched tracked asynchronously by EmbeddingWorker
  }

  private async *getStream(mediaType: 'recent_media' | 'top_media') {
    if ('streamRecentMedia' in this.platformClient) {
      yield* (this.platformClient as InstagramClient).streamRecentMedia(mediaType);
    } else {
      const items = await this.platformClient.fetchRecentMedia();
      yield* items;
    }
  }
}
