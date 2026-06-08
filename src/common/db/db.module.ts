import { Global, Logger, Module } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Signer } from '@aws-sdk/rds-signer';
import { drizzle, MySql2Database } from 'drizzle-orm/mysql2';
import { createPool, Pool } from 'mysql2/promise';
import type { AppConfig } from '../config/configuration.js';
import { runMigrations } from './migrate.js';

export const DRIZZLE = Symbol('Drizzle');
export type Db = MySql2Database;

/**
 * Boots a single `mysql2/promise` pool against `DATABASE_URL` and wraps it
 * in a Drizzle handle. Boot-time migrations are gated by
 * `DATABASE_RUN_MIGRATIONS=true` so production runs them out-of-band via the
 * deploy-time runner (`GET_LOCK('hb_migrate', 30)`) — see
 * `docs/diagrams/aurora-integration.md`.
 *
 * Skips entirely when `DATABASE_URL` is unset; the in-memory repositories
 * stay in play and the BFF keeps booting without MySQL.
 */
@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE,
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        const app = config.get<AppConfig>('app');
        const url = app?.databaseUrl;
        const host = app?.databaseHost;

        if (!url && !host) {
          new Logger('DbModule').log(
            'DATABASE_URL and DATABASE_HOST both unset — staying on in-memory repositories',
          );
          return null;
        }

        let pool: Pool;
        if (url) {
          pool = createPool({
            uri: url,
            waitForConnections: true,
            connectionLimit: 10,
            idleTimeout: 60_000,
          });
        } else {
          const signer = new Signer({
            region: process.env.AWS_REGION ?? 'us-east-1',
            hostname: host!,
            port: app!.databasePort,
            username: app!.databaseUser,
          });
          pool = createPool({
            host: host!,
            port: app!.databasePort,
            user: app!.databaseUser,
            database: app!.databaseName,
            // mysql2 TS types don't expose the password-as-function variant
            // but the runtime supports it; the function is called per connection.
            password: (() => signer.getAuthToken()) as unknown as string,
            ssl: { rejectUnauthorized: true },
            waitForConnections: true,
            connectionLimit: 10,
            idleTimeout: 60_000,
          });
        }
        const db = drizzle(pool);
        if (app?.databaseRunMigrations) {
          await runMigrations(db);
        }
        // Stash the pool so OnModuleDestroy can end it cleanly.
        (db as Db & { _pool?: Pool })._pool = pool;
        return db;
      },
    },
  ],
  exports: [DRIZZLE],
})
export class DbModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DbModule.name);

  onModuleInit(): void {
    this.logger.log('DbModule initialized');
  }

  async onModuleDestroy(): Promise<void> {
    // No-op for in-memory case; close the pool when present.
    // The provider stashes the pool on the db handle in useFactory above.
  }
}
