import { Router } from 'express';
import type { ISearchController } from '../../interfaces';

export function createSearchRouter(controller: ISearchController): Router {
  const router = Router();
  router.post('/search', (req, res) => controller.search(req, res));
  return router;
}
