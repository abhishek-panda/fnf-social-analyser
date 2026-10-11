import type { ConfigService } from '../config';
import type {
  IDirectMatchRepository,
  IEmbeddingClient,
  ISearchService,
  ISemanticMatchRepository,
} from '../interfaces';
import type { MatchedPost, PostRow, ProductSearchInput, SearchResponse, SemanticResult } from '../types';
import { logger } from '../utils/logger';

/** Orchestrates Tier 1 (direct) and Tier 2 (semantic) matching. */
export class SearchService implements ISearchService {
  constructor(
    private readonly directRepo: IDirectMatchRepository,
    private readonly semanticRepo: ISemanticMatchRepository,
    private readonly embeddingClient: IEmbeddingClient,
    private readonly config: ConfigService
  ) {}

  async search(input: ProductSearchInput): Promise<SearchResponse> {
    // Tier 1a — product tag exact match
    const byTag = await this.directRepo.findByProductTag(input.tpnb);
    if (byTag.length > 0) {
      logger.info(`[SearchService] ${input.tpnb} — ${byTag.length} direct tag match(es)`);
      return this.directResponse(input.tpnb, byTag);
    }

    // Tier 1b — product URL match
    if (input.productUrl) {
      const byUrl = await this.directRepo.findByProductUrl(input.productUrl);
      if (byUrl.length > 0) {
        logger.info(`[SearchService] ${input.tpnb} — ${byUrl.length} direct URL match(es)`);
        return this.directResponse(input.tpnb, byUrl);
      }
    }

    // Tier 2 — semantic match via FashionCLIP + pgvector
    logger.info(`[SearchService] ${input.tpnb} — no direct match, running semantic search`);
    const embedding = await this.embeddingClient.embed(input.imageUrl, input.caption);
    const results = await this.semanticRepo.findSimilar(
      embedding,
      this.config.similarityLimit,
      this.config.similarityThreshold
    );

    logger.info(`[SearchService] ${input.tpnb} — ${results.length} semantic match(es)`);

    if (results.length === 0) {
      return { tpnb: input.tpnb, total: 0, matchType: 'none', posts: [] };
    }

    return {
      tpnb: input.tpnb,
      total: results.length,
      matchType: 'semantic',
      posts: results.map((r) => this.toMatchedPost(r)),
    };
  }

  private toImageUrl(imagePath: string | null): string | null {
    if (!imagePath) return null;
    return `${this.config.mediaBaseUrl}/${imagePath}`;
  }

  private directResponse(tpnb: string, rows: PostRow[]): SearchResponse {
    return {
      tpnb,
      total: rows.length,
      matchType: 'direct',
      posts: rows.map((r) => ({
        postId: r.id,
        platform: r.platform,
        url: r.url,
        caption: r.caption,
        image_url: this.toImageUrl(r.image_path),
        published_at: r.published_at,
        matchType: 'direct' as const,
        score: 1.0,
      })),
    };
  }

  private toMatchedPost(r: SemanticResult): MatchedPost {
    return {
      postId: r.postId,
      platform: r.platform,
      url: r.url,
      caption: r.caption,
      image_url: this.toImageUrl(r.image_path),
      published_at: r.published_at,
      matchType: 'semantic',
      score: r.score,
    };
  }
}
