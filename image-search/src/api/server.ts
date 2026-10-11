import express, { type Express } from 'express';
import type { ISearchController } from '../interfaces';
import { createSearchRouter } from './routes/search';

/** Creates and configures the Express application — does not start listening. */
export function createServer(searchController: ISearchController): Express {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'image-search' }));
  app.use('/', createSearchRouter(searchController));

  return app;
}
