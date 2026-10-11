import express, { Application, Request, Response, NextFunction } from 'express';
import type { ISyncController } from '../interfaces';
import { registerDevRoutes } from './routes/devRoutes';
import type { ConfigService } from '../config';

export class AppServer {
  constructor(
    private readonly syncController: ISyncController,
    private readonly config: ConfigService
  ) {}

  build(): Application {
    const app = express();

    app.use(express.json());

    app.get('/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok', env: this.config.app.env });
    });

    const devRouter = express.Router();
    registerDevRoutes(devRouter, this.syncController);
    app.use('/__dev', devRouter);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    app.use((err: Error & { status?: number; statusCode?: number }, _req: Request, res: Response, _next: NextFunction) => {
      const statusCode = err.status ?? err.statusCode ?? 500;
      const safeMessage = statusCode >= 500
        ? 'An internal error occurred. Please try again later.'
        : err.message;

      res.status(statusCode).json({ statusCode, error: err.name ?? 'Internal Server Error', message: safeMessage });
    });

    return app;
  }
}
