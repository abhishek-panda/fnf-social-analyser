import { ConfigService } from './config';
import { Database } from './db';
import { DirectMatchRepository } from './repositories/DirectMatchRepository';
import { SemanticMatchRepository } from './repositories/SemanticMatchRepository';
import { EmbeddingClient } from './services/EmbeddingClient';
import { SearchService } from './services/SearchService';
import { SearchController } from './api/controllers/SearchController';
import type { ISearchService, ISearchController } from './interfaces';

export interface Container {
  config: ConfigService;
  searchService: ISearchService;
  searchController: ISearchController;
}

/** Wires the full dependency graph and returns the ready container. */
export async function buildContainer(): Promise<Container> {
  const config = new ConfigService();

  const database = new Database(config.db);
  await database.initialise();

  const embeddingClient = new EmbeddingClient(config);
  const directRepo = new DirectMatchRepository(database.pool);
  const semanticRepo = new SemanticMatchRepository(database.pool);

  const searchService = new SearchService(directRepo, semanticRepo, embeddingClient, config);
  const searchController = new SearchController(searchService);

  return { config, searchService, searchController };
}
