export interface AppConfig {
  env: string;
  port: number;
  /** Base path for downloaded media files — combined with platform + image_path to get full path */
  mediaPath: string;
}

export interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface InstagramConfig {
  accessToken: string | undefined;
  /** ISO-8601 expiry date written back by TokenRefreshService after a refresh. */
  tokenExpiresAt: string | undefined;
  businessAccountId: string | undefined;
  apiVersion: string;
  baseUrl: string;
  tokenRefreshDaysBeforeExpiry: number;
  /** Hashtags to track (without #). Comma-separated in env: INSTAGRAM_TRACKED_HASHTAGS=fandf,fandfclothing */
  trackedHashtags: string[];
}

export interface IngestionConfig {
  /** Cron for recent_media ingestion (default: every 1 hour) */
  recentMediaCronSchedule: string;
  /** Cron for top_media ingestion (default: every 1 hour) */
  topMediaCronSchedule: string;
  /** Cron schedule for the token refresh check (default: every day at midnight) */
  tokenRefreshCronSchedule: string;
}

export interface RedisConfig {
  host: string;
  port: number;
}

export interface EmbeddingServiceConfig {
  /** Base URL of the embedding-service sidecar (default: http://localhost:8000) */
  baseUrl: string;
  /** Whether to call the embedding-service at ingest time (default: true) */
  enabled: boolean;
}

export interface Config {
  app: AppConfig;
  db: DbConfig;
  instagram: InstagramConfig;
  ingestion: IngestionConfig;
  embedding: EmbeddingServiceConfig;
  redis: RedisConfig;
}

/** Loads and validates configuration from environment variables. */
export class ConfigService {
  public readonly app: AppConfig;
  public readonly db: DbConfig;
  public readonly instagram: InstagramConfig;
  public readonly ingestion: IngestionConfig;
  public readonly embedding: EmbeddingServiceConfig;
  public readonly redis: RedisConfig;

  constructor() {
    const apiVersion = process.env.INSTAGRAM_API_VERSION ?? 'v19.0';

    this.app = {
      env: process.env.NODE_ENV ?? 'development',
      port: parseInt(process.env.FEED_COLLECTOR_SERVICE_PORT ?? '3000', 10),
      mediaPath: process.env.MEDIA_PATH ?? './media',
    };

    this.db = {
      host: process.env.DB_HOST ?? 'localhost',
      port: parseInt(process.env.DB_PORT ?? '5432', 10),
      database: process.env.DB_NAME ?? 'fnf_social_analyser',
      user: process.env.DB_USER ?? 'postgres',
      password: process.env.DB_PASSWORD ?? 'postgres',
    };

    this.instagram = {
      accessToken: process.env.INSTAGRAM_ACCESS_TOKEN,
      tokenExpiresAt: process.env.INSTAGRAM_TOKEN_EXPIRES_AT,
      businessAccountId: process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID,
      apiVersion,
      baseUrl: `https://graph.facebook.com/${apiVersion}`,
      tokenRefreshDaysBeforeExpiry: parseInt(
        process.env.TOKEN_REFRESH_DAYS_BEFORE_EXPIRY ?? '7',
        10
      ),
      trackedHashtags: (process.env.INSTAGRAM_TRACKED_HASHTAGS ?? 'fandfclothing,fandf')
        .split(',')
        .map((h) => h.trim())
        .filter((h) => h.length > 0),
    };

    this.ingestion = {
      recentMediaCronSchedule: process.env.RECENT_MEDIA_CRON_SCHEDULE ?? '0 * * * *',
      topMediaCronSchedule: process.env.TOP_MEDIA_CRON_SCHEDULE ?? '0 * * * *',
      tokenRefreshCronSchedule: process.env.TOKEN_REFRESH_CRON_SCHEDULE ?? '0 0 * * *',
    };

    this.embedding = {
      baseUrl: process.env.EMBEDDING_SERVICE_URL ?? 'http://localhost:8000',
      enabled: process.env.EMBEDDING_SERVICE_ENABLED !== 'false',
    };

    this.redis = {
      host: process.env.REDIS_HOST ?? 'localhost',
      port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    };
  }
}


