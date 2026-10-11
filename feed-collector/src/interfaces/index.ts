import type {
  Post,
  NewPost,
  Platform,
  InstagramToken,
  TokenRefreshResult,
} from '../types';

/** Post persistence operations. */
export interface IPostRepository {
  upsert(post: NewPost): Promise<Post>;
  updateImagePath(postId: string, imagePath: string): Promise<void>;
  savePostEmbedding(postId: string, imagePath: string | null, cleanCaption: string, embedding: number[], embedSource: string, modelVersion: string): Promise<void>;
  findById(id: string): Promise<Post | null>;
}

import type { MediaItem } from '../platforms/InstagramClient';

/** A normalised social platform client. Adding TikTok means adding TikTokClient. */
export interface ISocialPlatformClient {
  readonly platform: Platform;
  fetchRecentMedia(): Promise<MediaItem[]>;
}

export interface IIngestionService {
  runCycle(mediaType?: 'recent_media' | 'top_media'): Promise<{ total: number; matched: number }>;
}

export interface ITokenRepository {
  /** Returns the current stored token, or null if none exists yet. */
  getLatest(): Promise<InstagramToken | null>;
  /** Persists a refreshed token, replacing the previous row. */
  save(accessToken: string, expiresAt: Date | null): Promise<InstagramToken>;
}

export interface ITokenRefreshService {
  /**
   * Upserts the token from env into DB on startup.
   * No-op if env has no token. Replaces any existing DB row.
   */
  seedFromEnv(): Promise<void>;
  /**
   * Returns the current access token.
   * Reads from DB (source of truth); falls back to config if DB has none.
   */
  getAccessToken(): Promise<string>;
  /**
   * Exchanges the current token for a fresh long-lived token if it expires
   * within the configured refresh window (default: 7 days).
   * No-op if the token is not near expiry or has no expiry (System User token).
   */
  refreshIfNeeded(): Promise<TokenRefreshResult>;
}

import type { Request, Response, NextFunction } from 'express';

export interface ISyncController {
  sync(req: Request, res: Response, next: NextFunction): Promise<void>;
  triggerIngestion(req: Request, res: Response, next: NextFunction): Promise<void>;
}
