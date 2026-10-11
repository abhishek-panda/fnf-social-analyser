import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
import { buildContainer } from './container';
import { AppScheduler } from './tasks/AppScheduler';
import { attachHttpLogger } from './utils/httpLogger';

attachHttpLogger();

async function bootstrap(): Promise<void> {
  const { config, tasks, appServer, embeddingWorker } = await buildContainer();

  const app = appServer.build();
  const port = config.app.port;

  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`[bootstrap] Server running on port ${port} (${config.app.env})`);
    console.log(`[bootstrap] Embedding worker listening on queue`);
    new AppScheduler().register(tasks).start();
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[bootstrap] ${signal} received — shutting down`);
    server.close(async () => {
      await embeddingWorker.close();
      console.log('[bootstrap] Shutdown complete');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

void bootstrap();
