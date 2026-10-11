import { Pool } from 'pg';
import type { DbConfig } from '../config';
import { logger } from '../utils/logger';

/** Wraps pg Pool with a clean injectable interface. */
export class Database {
  public readonly pool: Pool;

  constructor(config: DbConfig) {
    this.pool = new Pool({
      host:     config.host,
      port:     config.port,
      database: config.database,
      user:     config.user,
      password: config.password,
    });

    this.pool.on('error', (err: Error) => {
      logger.error('[DB] Unexpected client error', { message: err.message });
    });
  }

  /** Tests connectivity — throws if the database is unreachable. */
  async initialise(): Promise<void> {
    await this.pool.query('SELECT 1');
    logger.info('[DB] Connection established');
  }
}
