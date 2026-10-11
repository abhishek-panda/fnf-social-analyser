import fs from 'fs';
import path from 'path';
import axios from 'axios';
import type { ITokenRefreshService, ITokenRepository } from '../interfaces';
import type { InstagramConfig } from '../config';
import type { TokenRefreshResult } from '../types';

interface GraphTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

/** Shape returned by the Instagram token debug/info endpoint. */
interface TokenInfoResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

/**
 * Manages the Instagram long-lived access token lifecycle.
 *
 * Token source priority:
 *   1. DB (instagram_tokens table) — source of truth at runtime
 *   2. INSTAGRAM_ACCESS_TOKEN env var — validated then seeded into DB on startup
 *
 * On refresh: validates the new token, then persists to DB and writes back to .env.
 * Invalid tokens are never saved to DB or written to .env.
 */
export class TokenRefreshService implements ITokenRefreshService {
  private readonly REFRESH_ENDPOINT = 'https://graph.instagram.com/refresh_access_token';
  private get VALIDATE_ENDPOINT(): string { return `${this.config.baseUrl}/me`; }
  private readonly MS_PER_DAY = 24 * 60 * 60 * 1000;
  private readonly ENV_PATH: string;

  constructor(
    private readonly tokenRepo: ITokenRepository,
    private readonly config: InstagramConfig,
    envPath?: string
  ) {
    this.ENV_PATH = envPath ?? path.resolve(process.cwd(), '.env');
  }

  /**
   * Validates a token against the Instagram API.
   * Returns true if the token is accepted, false if invalid/expired.
   */
  private async isTokenValid(token: string): Promise<boolean> {
    try {
      await axios.get(this.VALIDATE_ENDPOINT, {
        params: { fields: 'id', access_token: token },
      });
      return true;
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const code = (err.response?.data as { error?: { code?: number } })?.error?.code;
        // 190 = invalid/expired token, 100 = invalid param — both mean bad token
        if (err.response?.status === 400 || code === 190 || code === 100) {
          return false;
        }
      }
      // Network error or unexpected — don't assume invalid, re-throw
      throw err;
    }
  }

  /**
   * Validates the token from INSTAGRAM_ACCESS_TOKEN env var then seeds it into DB.
   * Skips if env var is not set or token fails validation.
   * Called once at startup — replaces any existing DB row.
   */
  async seedFromEnv(): Promise<void> {
    const token = this.config.accessToken;
    if (!token) {
      console.warn('[TokenRefreshService] INSTAGRAM_ACCESS_TOKEN not set — skipping seed');
      return;
    }

    console.log('[TokenRefreshService] Validating token from env...');
    const valid = await this.isTokenValid(token);

    if (!valid) {
      console.error(
        '[TokenRefreshService] INSTAGRAM_ACCESS_TOKEN in .env is invalid or expired — skipping seed. Update .env with a valid token.'
      );
      return;
    }

    const expiresAt = this.config.tokenExpiresAt
      ? new Date(this.config.tokenExpiresAt)
      : new Date(Date.now() + 60 * this.MS_PER_DAY);

    await this.tokenRepo.save(token, expiresAt);
    console.log(`[TokenRefreshService] Token seeded from env. Expiry: ${expiresAt.toISOString()}`);
  }

  async getAccessToken(): Promise<string> {
    const stored = await this.tokenRepo.getLatest();
    if (stored) return stored.access_token;

    if (this.config.accessToken) {
      console.warn('[TokenRefreshService] No token in DB — falling back to env var');
      return this.config.accessToken;
    }

    throw new Error(
      '[TokenRefreshService] No Instagram access token available. Set INSTAGRAM_ACCESS_TOKEN in .env'
    );
  }

  async refreshIfNeeded(): Promise<TokenRefreshResult> {
    const stored = await this.tokenRepo.getLatest();

    if (!stored) {
      console.warn('[TokenRefreshService] No token in DB — skipping refresh');
      return { refreshed: false, expiresAt: null };
    }

    if (!stored.expires_at) {
      console.log('[TokenRefreshService] Token has no expiry (System User token) — skipping refresh');
      return { refreshed: false, expiresAt: null };
    }

    const daysUntilExpiry = (stored.expires_at.getTime() - Date.now()) / this.MS_PER_DAY;

    if (daysUntilExpiry > this.config.tokenRefreshDaysBeforeExpiry) {
      console.log(`[TokenRefreshService] Token expires in ${daysUntilExpiry.toFixed(1)}d — no refresh needed`);
      return { refreshed: false, expiresAt: stored.expires_at };
    }

    console.log(`[TokenRefreshService] Token expires in ${daysUntilExpiry.toFixed(1)}d — refreshing...`);
    return this.exchange(stored.access_token);
  }

  private async exchange(currentToken: string): Promise<TokenRefreshResult> {
    const { data } = await axios.get<GraphTokenResponse>(this.REFRESH_ENDPOINT, {
      params: {
        grant_type: 'ig_refresh_token',
        access_token: currentToken,
      },
    });

    const newToken = data.access_token;
    const expiresAt = new Date(Date.now() + data.expires_in * 1000);

    // Validate the new token before persisting — don't save a bad token
    console.log('[TokenRefreshService] Validating refreshed token...');
    const valid = await this.isTokenValid(newToken);
    if (!valid) {
      throw new Error('[TokenRefreshService] Refreshed token failed validation — not persisted');
    }

    await this.tokenRepo.save(newToken, expiresAt);
    this.writeBackToEnv(newToken, expiresAt);

    console.log(`[TokenRefreshService] Token refreshed. New expiry: ${expiresAt.toISOString()}`);
    return { refreshed: true, expiresAt };
  }

  /**
   * Writes the validated refreshed token and expiry back to .env.
   * Only called after successful validation — invalid tokens never reach here.
   */
  private writeBackToEnv(token: string, expiresAt: Date): void {
    try {
      let content = fs.existsSync(this.ENV_PATH)
        ? fs.readFileSync(this.ENV_PATH, 'utf8')
        : '';

      content = this.upsertEnvVar(content, 'INSTAGRAM_ACCESS_TOKEN', token);
      content = this.upsertEnvVar(content, 'INSTAGRAM_TOKEN_EXPIRES_AT', expiresAt.toISOString());

      fs.writeFileSync(this.ENV_PATH, content, 'utf8');
      console.log('[TokenRefreshService] Token written back to .env');
    } catch (err) {
      console.error(
        '[TokenRefreshService] Failed to write token back to .env:',
        err instanceof Error ? err.message : err
      );
    }
  }

  private upsertEnvVar(content: string, key: string, value: string): string {
    const NL = String.fromCharCode(10);
    const line = key + '=' + value;
    const regex = new RegExp('^' + key + '=.*$', 'm');

    if (regex.test(content)) {
      return content.replace(regex, line);
    }
    return content.endsWith(NL)
      ? content + line + NL
      : content + NL + line + NL;
  }
}
