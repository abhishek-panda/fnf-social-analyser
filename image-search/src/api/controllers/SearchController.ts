import type { Request, Response } from 'express';
import type { ISearchController, ISearchService } from '../../interfaces';
import type { ProductSearchInput } from '../../types';
import { logger } from '../../utils/logger';

/** Thin HTTP adapter — validates the request body and delegates to SearchService. */
export class SearchController implements ISearchController {
  constructor(private readonly searchService: ISearchService) {}

  async search(req: Request, res: Response): Promise<void> {
    const { tpnb, imageUrl, caption, productUrl } = req.body as Partial<ProductSearchInput>;

    if (!tpnb || !imageUrl || !caption) {
      res.status(400).json({ error: 'tpnb, imageUrl, and caption are required' });
      return;
    }

    try {
      const result = await this.searchService.search({ tpnb, imageUrl, caption, productUrl });
      res.json(result);
    } catch (err) {
      logger.error('[SearchController] Search failed', {
        tpnb,
        message: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: 'Search failed' });
    }
  }
}
