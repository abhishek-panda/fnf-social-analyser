import { Queue } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';

export const EMBED_QUEUE_NAME = 'embed';

/** Job payload published after a post is ingested and image downloaded. */
export interface EmbedJobData {
  postId: string;
  platform: string;
  externalId: string;
  caption: string | null;
  imagePath: string | null;  // filename only e.g. 17888291706617649.jpg
}

/** Create the BullMQ Queue for publishing embed jobs. */
export function createEmbedQueue(connection: ConnectionOptions): Queue<EmbedJobData> {
  return new Queue<EmbedJobData>(EMBED_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    },
  });
}
