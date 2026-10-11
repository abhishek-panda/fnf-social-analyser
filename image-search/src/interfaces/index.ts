import type { Request, Response } from 'express';
import type { PostRow, ProductSearchInput, SearchResponse, SemanticResult } from '../types';

export interface ISearchController {
  search(req: Request, res: Response): Promise<void>;
}

export interface ISearchService {
  search(input: ProductSearchInput): Promise<SearchResponse>;
}

export interface IDirectMatchRepository {
  findByProductTag(tpnb: string): Promise<PostRow[]>;
  findByProductUrl(productUrl: string): Promise<PostRow[]>;
}

export interface ISemanticMatchRepository {
  findSimilar(embedding: number[], limit: number, threshold: number): Promise<SemanticResult[]>;
}

export interface IEmbeddingClient {
  embed(imageUrl: string, caption: string): Promise<number[]>;
}
