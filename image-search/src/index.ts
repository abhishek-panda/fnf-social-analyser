import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
import { buildContainer } from './container';
import { createServer } from './api/server';
import { logger } from './utils/logger';

async function bootstrap(): Promise<void> {
  const container = await buildContainer();
  const app = createServer(container.searchController);
  const port = container.config.port;
  app.listen(port, () => logger.info(`[image-search] Running on port ${port}`));
}

bootstrap().catch((err) => {
  logger.error('[image-search] Fatal startup error', {
    message: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
