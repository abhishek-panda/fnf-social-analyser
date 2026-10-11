import axios from 'axios';
import { logger } from '../utils/logger';
import type { EmbeddingServiceConfig } from '../config';

export interface EmbedResult {
  embedding: number[];
  cleanCaption: string;
  source: string;
  modelVersion: string;
}

/**
 * Calls POST /embed/combined on the embedding-service.
 * Caption cleaning happens internally inside the embedding-service — not here.
 * Returns null if disabled, unreachable, or no usable input.
 */
export class EmbeddingService {
  constructor(private readonly config: EmbeddingServiceConfig) {}

  async embed(caption: string | null, fullImagePath: string | null): Promise<EmbedResult | null> {
    if (!this.config.enabled) return null;
    if (!caption?.trim() && !fullImagePath) return null;

    try {
      const { data } = await axios.post<{ embedding: number[]; clean_caption: string; source: string; model_version: string }>(
        `${this.config.baseUrl}/embed/combined`,
        {
          caption: caption ?? '',
          image_path: fullImagePath ?? '',
        }
      );

      logger.debug(`[EmbeddingService] ${data.source} — ${data.embedding.length} dims — ${data.model_version}`);

      return {
        embedding: data.embedding,
        cleanCaption: data.clean_caption,
        source: data.source,
        modelVersion: data.model_version,
      };
    } catch (err) {
      const message = axios.isAxiosError(err)
        ? `${err.response?.status ?? 'network'} — ${JSON.stringify(err.response?.data)}`
        : err instanceof Error ? err.message : String(err);
      logger.warn('[EmbeddingService] Failed to generate embedding', { message });
      return null;
    }
  }
}
