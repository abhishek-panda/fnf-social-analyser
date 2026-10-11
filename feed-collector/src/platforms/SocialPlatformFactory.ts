import type { ISocialPlatformClient, ITokenRefreshService } from '../interfaces';
import type { InstagramConfig } from '../config';
import type { Platform } from '../types';
import { InstagramClient } from './InstagramClient';

export interface IPlatformFactory {
  create(platform: Platform): ISocialPlatformClient;
}

export class SocialPlatformFactory implements IPlatformFactory {
  constructor(
    private readonly instagramConfig: InstagramConfig,
    private readonly tokenService: ITokenRefreshService
  ) {}

  create(platform: Platform): ISocialPlatformClient {
    switch (platform) {
      case 'instagram':
        return new InstagramClient(this.instagramConfig, this.tokenService);
      case 'tiktok':
      case 'pinterest':
      case 'x':
        throw new Error(`Platform "${platform}" is not yet implemented.`);
      default: {
        const _exhaustive: never = platform;
        throw new Error(`Unknown platform: ${String(_exhaustive)}`);
      }
    }
  }
}
