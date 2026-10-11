import os from 'os';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { TokenRefreshService } from '../src/services/TokenRefreshService';
import type { ITokenRepository } from '../src/interfaces';
import type { InstagramToken } from '../src/types';
import type { InstagramConfig } from '../src/config';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Isolated temp .env path — tests never touch the real .env file
const TEST_ENV_PATH = path.join(os.tmpdir(), `fnf-test-${process.pid}.env`);

afterAll(() => {
  if (fs.existsSync(TEST_ENV_PATH)) fs.unlinkSync(TEST_ENV_PATH);
});

function buildTokenRepo(overrides: Partial<ITokenRepository> = {}): ITokenRepository {
  return {
    getLatest: jest.fn(),
    save: jest.fn(),
    ...overrides,
  };
}

/** Always injects a temp env path so tests never write to the real .env */
function buildService(repo: ITokenRepository, config?: InstagramConfig): TokenRefreshService {
  return new TokenRefreshService(repo, config ?? buildConfig(), TEST_ENV_PATH);
}

function buildConfig(overrides: Partial<InstagramConfig> = {}): InstagramConfig {
  return {
    accessToken: 'env-fallback-token',
    tokenExpiresAt: undefined,
    businessAccountId: '1234',
    apiVersion: 'v19.0',
    baseUrl: 'https://graph.facebook.com/v19.0',
    tokenRefreshDaysBeforeExpiry: 7,
    trackedHashtags: ['fandfclothing', 'fandf'],
    ...overrides,
  };
}

function buildStoredToken(overrides: Partial<InstagramToken> = {}): InstagramToken {
  return {
    id: 1,
    access_token: 'db-stored-token',
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
    refreshed_at: new Date(),
    created_at: new Date(),
    ...overrides,
  };
}

beforeEach(() => jest.clearAllMocks());

// ─── seedFromEnv ──────────────────────────────────────────────────────────────

describe('TokenRefreshService.seedFromEnv', () => {
  test('validates then saves token with 60-day default expiry when tokenExpiresAt is not set', async () => {
    mockedAxios.get = jest.fn().mockResolvedValue({ data: { id: '123' } }); // valid token
    const repo = buildTokenRepo({ save: jest.fn().mockResolvedValue(buildStoredToken()) });
    const service = buildService(repo, buildConfig({ accessToken: 'env-token', tokenExpiresAt: undefined }));

    await service.seedFromEnv();

    expect(repo.save).toHaveBeenCalledTimes(1);
    const [savedToken, savedExpiry] = (repo.save as jest.Mock).mock.calls[0] as [string, Date];
    expect(savedToken).toBe('env-token');
    const daysUntilExpiry = (savedExpiry.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(daysUntilExpiry).toBeGreaterThan(58);
    expect(daysUntilExpiry).toBeLessThanOrEqual(60);
  });

  test('validates then saves token with parsed expiry when tokenExpiresAt is set in env', async () => {
    mockedAxios.get = jest.fn().mockResolvedValue({ data: { id: '123' } }); // valid token
    const expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const repo = buildTokenRepo({ save: jest.fn().mockResolvedValue(buildStoredToken()) });
    const service = buildService(repo, buildConfig({
      accessToken: 'env-token',
      tokenExpiresAt: expiry.toISOString(),
    }));

    await service.seedFromEnv();

    const [, savedExpiry] = (repo.save as jest.Mock).mock.calls[0] as [string, Date];
    expect(Math.abs(savedExpiry.getTime() - expiry.getTime())).toBeLessThan(1000);
  });

  test('does not save when token is invalid (API returns 400)', async () => {
    const axiosError = Object.assign(new Error('Bad Request'), {
      isAxiosError: true,
      response: { status: 400, data: { error: { code: 190, message: 'Invalid token' } } },
    });
    mockedAxios.get = jest.fn().mockRejectedValue(axiosError);
    jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);
    const repo = buildTokenRepo({ save: jest.fn() });
    const service = buildService(repo, buildConfig({ accessToken: 'invalid-token' }));

    await service.seedFromEnv();

    expect(repo.save).not.toHaveBeenCalled();
  });

  test('does nothing when accessToken is not set in env', async () => {
    const repo = buildTokenRepo({ save: jest.fn() });
    const service = buildService(repo, buildConfig({ accessToken: undefined }));

    await service.seedFromEnv();

    expect(repo.save).not.toHaveBeenCalled();
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });
});

describe('TokenRefreshService.getAccessToken', () => {
  test('returns token from DB when one exists', async () => {
    const repo = buildTokenRepo({
      getLatest: jest.fn().mockResolvedValue(buildStoredToken({ access_token: 'db-token' })),
    });
    const service = buildService(repo, buildConfig());

    const token = await service.getAccessToken();

    expect(token).toBe('db-token');
    expect(repo.getLatest).toHaveBeenCalledTimes(1);
  });

  test('falls back to config env token when DB has no row', async () => {
    const repo = buildTokenRepo({ getLatest: jest.fn().mockResolvedValue(null) });
    const service = buildService(repo, buildConfig({ accessToken: 'env-token' }));

    const token = await service.getAccessToken();

    expect(token).toBe('env-token');
  });

  test('throws when DB is empty and config has no token', async () => {
    const repo = buildTokenRepo({ getLatest: jest.fn().mockResolvedValue(null) });
    const service = buildService(repo, buildConfig({ accessToken: undefined }));

    await expect(service.getAccessToken()).rejects.toThrow(
      'No Instagram access token available'
    );
  });
});

describe('TokenRefreshService.refreshIfNeeded', () => {
  test('returns refreshed:false and skips API call when token has no expiry (System User)', async () => {
    const repo = buildTokenRepo({
      getLatest: jest.fn().mockResolvedValue(buildStoredToken({ expires_at: null })),
    });
    const service = buildService(repo, buildConfig());

    const result = await service.refreshIfNeeded();

    expect(result).toEqual({ refreshed: false, expiresAt: null });
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  test('returns refreshed:false when token expires far in the future (> threshold)', async () => {
    const farExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    const repo = buildTokenRepo({
      getLatest: jest.fn().mockResolvedValue(buildStoredToken({ expires_at: farExpiry })),
    });
    const service = buildService(repo, buildConfig({ tokenRefreshDaysBeforeExpiry: 7 }));

    const result = await service.refreshIfNeeded();

    expect(result).toEqual({ refreshed: false, expiresAt: farExpiry });
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  test('refreshes token when it expires within the threshold window', async () => {
    const nearExpiry = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // 3 days — within 7-day threshold
    const repo = buildTokenRepo({
      getLatest: jest.fn().mockResolvedValue(
        buildStoredToken({ access_token: 'old-token', expires_at: nearExpiry })
      ),
      save: jest.fn().mockImplementation((token: string, expiresAt: Date) =>
        Promise.resolve(buildStoredToken({ access_token: token, expires_at: expiresAt }))
      ),
    });

    const expiresInSeconds = 60 * 24 * 60 * 60; // 60 days in seconds
    mockedAxios.get = jest.fn()
      // First call: token refresh API
      .mockResolvedValueOnce({
        data: { access_token: 'new-refreshed-token', token_type: 'bearer', expires_in: expiresInSeconds },
      })
      // Second call: validation of new token
      .mockResolvedValueOnce({ data: { id: '123' } });

    const service = buildService(repo, buildConfig({ tokenRefreshDaysBeforeExpiry: 7 }));
    const result = await service.refreshIfNeeded();

    expect(result.refreshed).toBe(true);
    expect(result.expiresAt).toBeInstanceOf(Date);

    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://graph.instagram.com/refresh_access_token',
      { params: { grant_type: 'ig_refresh_token', access_token: 'old-token' } }
    );

    expect(repo.save).toHaveBeenCalledWith('new-refreshed-token', expect.any(Date));
  });

  test('returns refreshed:false and does not throw when no token in DB', async () => {
    const repo = buildTokenRepo({ getLatest: jest.fn().mockResolvedValue(null) });
    const service = buildService(repo, buildConfig());

    const result = await service.refreshIfNeeded();

    expect(result).toEqual({ refreshed: false, expiresAt: null });
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  test('throws and does not persist when Graph API call fails', async () => {
    const nearExpiry = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000); // 2 days
    const repo = buildTokenRepo({
      getLatest: jest.fn().mockResolvedValue(
        buildStoredToken({ expires_at: nearExpiry })
      ),
      save: jest.fn(),
    });

    mockedAxios.get = jest.fn().mockRejectedValue(new Error('Network error'));

    const service = buildService(repo, buildConfig());

    await expect(service.refreshIfNeeded()).rejects.toThrow('Network error');
    expect(repo.save).not.toHaveBeenCalled();
  });

  test('new token expiry is approximately 60 days from now after refresh', async () => {
    const nearExpiry = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000); // 1 day
    const repo = buildTokenRepo({
      getLatest: jest.fn().mockResolvedValue(buildStoredToken({ expires_at: nearExpiry })),
      save: jest.fn().mockImplementation((token: string, expiresAt: Date) =>
        Promise.resolve(buildStoredToken({ access_token: token, expires_at: expiresAt }))
      ),
    });

    const sixtyDaysInSeconds = 60 * 24 * 60 * 60;
    mockedAxios.get = jest.fn()
      .mockResolvedValueOnce({ data: { access_token: 'refreshed', token_type: 'bearer', expires_in: sixtyDaysInSeconds } })
      .mockResolvedValueOnce({ data: { id: '123' } }); // validation

    const before = Date.now();
    const service = buildService(repo, buildConfig());
    const result = await service.refreshIfNeeded();
    const after = Date.now();

    const expiryMs = result.expiresAt!.getTime();
    const expectedMs = sixtyDaysInSeconds * 1000;

    expect(expiryMs).toBeGreaterThanOrEqual(before + expectedMs - 1000);
    expect(expiryMs).toBeLessThanOrEqual(after + expectedMs + 1000);
  });
});
