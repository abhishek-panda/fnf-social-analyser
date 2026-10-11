import { Router } from 'express';
import type { ISyncController } from '../../interfaces';

/** Registers hidden developer routes — not exposed via production gateways. */
export function registerDevRoutes(router: Router, controller: ISyncController): void {
  router.post('/sync', controller.sync.bind(controller));
  router.post('/ingest', controller.triggerIngestion.bind(controller));
}
