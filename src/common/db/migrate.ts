import { Logger } from '@nestjs/common';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import type { Db } from './db.module.js';

/**
 * Apply pending Drizzle migrations from ./drizzle.
 *
 * Local dev calls this at boot when `DATABASE_RUN_MIGRATIONS=true`. Prod uses
 * a separate deploy-time runner with `GET_LOCK('hb_migrate', 30)` so multiple
 * pods can't race — that runner shells out to `drizzle-kit migrate` against
 * the same SQL files committed under `./drizzle/`.
 */
export async function runMigrations(db: Db): Promise<void> {
  const logger = new Logger('runMigrations');
  logger.log('applying pending migrations from ./drizzle');
  await migrate(db, { migrationsFolder: './drizzle' });
  logger.log('migrations up to date');
}
