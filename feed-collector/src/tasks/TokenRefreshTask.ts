import type { Task } from './Task';
import type { ITokenRefreshService } from '../interfaces';

/** Wraps ITokenRefreshService as a Task so AppScheduler can register it. */
export class TokenRefreshTask implements Task {
  readonly name = 'TokenRefresh';

  constructor(
    private readonly tokenRefreshService: ITokenRefreshService,
    readonly schedule: string
  ) {}

  async run(): Promise<void> {
    const result = await this.tokenRefreshService.refreshIfNeeded();
    if (result.refreshed) {
      console.log(
        `[TokenRefreshTask] Token refreshed. New expiry: ${result.expiresAt?.toISOString() ?? 'none'}`
      );
    } else {
      console.log('[TokenRefreshTask] No refresh needed');
    }
  }
}
