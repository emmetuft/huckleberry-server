/**
 * Deploy-time migration runner.
 *
 * Uses MySQL's advisory lock so concurrent callers (e.g., multiple pods
 * starting simultaneously) don't race on DDL. One process wins the lock,
 * runs Drizzle's idempotent migrator, then releases. Others bail immediately
 * instead of blocking the cluster from coming up.
 *
 * Local dev:  DATABASE_URL=mysql://... tsx scripts/migrate-prod.ts
 * Aurora:     DATABASE_HOST=... DATABASE_USER=... DATABASE_NAME=... tsx scripts/migrate-prod.ts
 *             (IAM auth token generated automatically via @aws-sdk/rds-signer)
 *
 * Exit codes: 0 = migrations applied (or nothing to do), 1 = error or lock
 * already held by another process.
 */

import { Signer } from '@aws-sdk/rds-signer';
import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { createPool } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';

interface LockRow extends RowDataPacket {
  got: number;
}

async function main() {
  if (process.env.NODE_ENV !== 'production') {
    await import('dotenv/config');
  }

  const url = process.env.DATABASE_URL;
  const host = process.env.DATABASE_HOST;

  if (!url && !host) {
    console.error('Set DATABASE_URL (local) or DATABASE_HOST (Aurora)');
    process.exit(1);
  }

  const port = parseInt(process.env.DATABASE_PORT || '3306', 10);
  const user = process.env.DATABASE_USER ?? 'huckleberry_migrate';
  const database = process.env.DATABASE_NAME ?? 'huckleberry';

  let pool;
  if (url) {
    pool = createPool({ uri: url, connectionLimit: 1 });
  } else {
    const signer = new Signer({
      region: process.env.AWS_REGION ?? 'us-east-1',
      hostname: host,
      port,
      username: user,
    });
    pool = createPool({
      host: host,
      port,
      user,
      database,
      // mysql2 TS types don't expose the password-as-function variant
      // but the runtime supports it; the function is called per connection.
      password: (() => signer.getAuthToken()) as unknown as string,
      ssl: { rejectUnauthorized: true },
      connectionLimit: 1,
    });
  }

  const db = drizzle(pool);

  const [rows] = (await pool.execute(
    "SELECT GET_LOCK('hb_migrate', 30) AS got",
  )) as [LockRow[], unknown];
  const lockRow = rows[0];

  if (lockRow.got !== 1) {
    console.error(
      "Could not acquire advisory lock 'hb_migrate' — another migration may be running",
    );
    await pool.end();
    process.exit(1);
  }

  try {
    console.log('Running migrations from ./drizzle …');
    await migrate(db, { migrationsFolder: './drizzle' });
    console.log('Migrations complete.');
  } finally {
    await pool.execute("SELECT RELEASE_LOCK('hb_migrate')");
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
