import { ConfigService } from './config';
import { Database } from './db';
import { PostRepository } from './repositories/PostRepository';
import { TokenRepository } from './repositories/TokenRepository';
import { IngestionService } from './services/IngestionService';
import { ImageDownloaderService } from './services/ImageDownloaderService';
import { EmbeddingService } from './services/EmbeddingService';
import { createEmbedQueue } from './queue/embedQueue';
import { EmbeddingWorker } from './queue/EmbeddingWorker';
import { TokenRefreshService } from './services/TokenRefreshService';
import { SocialPlatformFactory } from './platforms/SocialPlatformFactory';
import { FeedIngestionTask } from './tasks/FeedIngestionTask';
import { TokenRefreshTask } from './tasks/TokenRefreshTask';
import type { Task } from './tasks/Task';
import { SyncController } from './api/controllers/SyncController';
import { AppServer } from './api/server';

export interface Container {
  config: ConfigService;
  tasks: Task[];
  appServer: AppServer;
  embeddingWorker: EmbeddingWorker;
}

/** Build and wire the full application dependency graph. */
export async function buildContainer(): Promise<Container> {
  const config = new ConfigService();
  const db = new Database(config.db);

  await db.initialise();

  const postRepository = new PostRepository(db);
  const tokenRepository = new TokenRepository(db);

  const tokenRefreshService = new TokenRefreshService(tokenRepository, config.instagram);
  await tokenRefreshService.seedFromEnv();

  const platformFactory = new SocialPlatformFactory(config.instagram, tokenRefreshService);
  const platformClient = platformFactory.create('instagram');

  const imageDownloader = new ImageDownloaderService(config.app.mediaPath);
  const embeddingService = new EmbeddingService(config.embedding);

  // BullMQ — persistent async embed queue via Redis
  const redisConnection = { host: config.redis.host, port: config.redis.port };
  const embedQueue = createEmbedQueue(redisConnection);
  const embeddingWorker = new EmbeddingWorker(
    redisConnection,
    postRepository,
    embeddingService,
    imageDownloader
  );

  const ingestionService = new IngestionService(platformClient, postRepository, imageDownloader, embedQueue);

  const tasks: Task[] = [
    new FeedIngestionTask(ingestionService, config.ingestion.recentMediaCronSchedule, 'recent_media'),
    new FeedIngestionTask(ingestionService, config.ingestion.topMediaCronSchedule, 'top_media'),
    new TokenRefreshTask(tokenRefreshService, config.ingestion.tokenRefreshCronSchedule),
  ];

  const syncController = new SyncController(tokenRefreshService, ingestionService);
  const appServer = new AppServer(syncController, config);

  return { config, tasks, appServer, embeddingWorker };
}
