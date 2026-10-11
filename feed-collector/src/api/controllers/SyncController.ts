import type { Request, Response, NextFunction } from 'express';
import type { IIngestionService, ITokenRefreshService, ISyncController } from '../../interfaces';

/** Runs token refresh then ingestion in sequence and returns a combined summary. */
export class SyncController implements ISyncController {
  constructor(
    private readonly tokenRefreshService: ITokenRefreshService,
    private readonly ingestionService: IIngestionService
  ) {}

  async sync(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const tokenResult = await this.tokenRefreshService.refreshIfNeeded();
      const ingestionResult = await this.ingestionService.runCycle();

      res.status(200).json({
        token: {
          refreshed: tokenResult.refreshed,
          expiresAt: tokenResult.expiresAt,
        },
        ingestion: {
          total: ingestionResult.total,
          matched: ingestionResult.matched,
        },
      });
    } catch (err) {
      next(err);
    }
  }

  async triggerIngestion(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      this.ingestionService.runCycle().catch((err: Error) => {
        console.error(`[SyncController] Manual ingestion failed: ${err.message}`);
      });
      res.status(202).json({ message: 'Ingestion cycle started' });
    } catch (err) {
      next(err);
    }
  }
}
