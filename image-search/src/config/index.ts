export interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface SearchConfig {
  similarityThreshold: number;
  similarityLimit: number;
}

/** Loads and validates all environment variables at startup. */
export class ConfigService {
  public readonly port: number;
  public readonly db: DbConfig;
  public readonly embeddingServiceUrl: string;
  public readonly mediaBaseUrl: string;
  public readonly similarityThreshold: number;
  public readonly similarityLimit: number;

  constructor() {
    // Required DB vars — throw early rather than fail at query time
    const dbHost = this.require('DB_HOST');
    const dbName = this.require('DB_NAME');
    const dbUser = this.require('DB_USER');
    const dbPassword = this.require('DB_PASSWORD');

    this.port = parseInt(process.env.IMAGE_SEARCH_SERVICE_PORT ?? '3001', 10);

    this.db = {
      host: dbHost,
      port: parseInt(process.env.DB_PORT ?? '5432', 10),
      database: dbName,
      user: dbUser,
      password: dbPassword,
    };

    this.embeddingServiceUrl = process.env.EMBEDDING_SERVICE_URL ?? 'http://localhost:7002';
    this.mediaBaseUrl = process.env.MEDIA_BASE_URL ?? `${this.embeddingServiceUrl}/__dev/media`;
    this.similarityThreshold = parseFloat(process.env.SIMILARITY_THRESHOLD ?? '0.3');
    this.similarityLimit = parseInt(process.env.SIMILARITY_LIMIT ?? '20', 10);
  }

  /** Reads a required env var — throws with a clear message if absent. */
  private require(key: string): string {
    const value = process.env[key];
    if (!value) {
      throw new Error(`[ConfigService] Missing required environment variable: ${key}`);
    }
    return value;
  }
}
