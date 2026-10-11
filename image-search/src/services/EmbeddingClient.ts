import axios from 'axios';
import type { IEmbeddingClient } from '../interfaces';
import type { ConfigService } from '../config';
import { logger } from '../utils/logger';

interface EmbedCombinedResponse {
  embedding: number[];
  source: 'combined' | 'text_only';
  clean_caption: string;
}

/** HTTP client for the FashionCLIP embedding-service /embed/combined endpoint. */
export class EmbeddingClient implements IEmbeddingClient {
  private readonly baseUrl: string;

  constructor(config: ConfigService) {
    this.baseUrl = config.embeddingServiceUrl;
  }

  /**
   * Embeds a product image + caption into a vector via the embedding-service.
   * @throws if the embedding service is unreachable or returns an unexpected payload.
   */
  async embed(imageUrl: string, caption: string): Promise<number[]> {
    const url = `${this.baseUrl}/embed/combined`;

    try {
      const { data } = await axios.post<EmbedCombinedResponse>(url, {
        image_path: imageUrl,
        caption,
      });

      if (!Array.isArray(data.embedding)) {
        throw new Error('Embedding service returned an unexpected payload — expected { embedding: number[] }');
      }

      logger.info('[EmbeddingClient] Embedding generated', {
        dims: data.embedding.length,
        source: data.source,
        clean_caption: data.clean_caption,
      });
      return data.embedding;
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status ?? 'no response';
        throw new Error(
          `[EmbeddingClient] Embedding service unreachable at ${url} — HTTP ${status}: ${err.message}`
        );
      }
      throw err;
    }
  }
}
