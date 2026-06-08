import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit config — used by `pnpm db:generate` and `pnpm db:migrate`.
 *
 * Local dev: set DATABASE_URL (embedded credentials, no SSL).
 * Aurora / remote: set DATABASE_HOST + DATABASE_USER + DATABASE_NAME and
 * pre-generate DATABASE_PASSWORD via:
 *   export DATABASE_PASSWORD=$(aws rds generate-db-auth-token \
 *     --hostname $DATABASE_HOST --port 3306 \
 *     --region us-east-1 --username $DATABASE_USER)
 */
const url = process.env.DATABASE_URL;
const host = process.env.DATABASE_HOST;

if (!url && !host) {
  throw new Error(
    'Set DATABASE_URL (local) or DATABASE_HOST (Aurora) before running drizzle-kit',
  );
}

export default defineConfig({
  dialect: 'mysql',
  schema: './src/common/db/schema.ts',
  out: './drizzle',
  dbCredentials: url
    ? { url }
    : {
        host: host!,
        port: parseInt(process.env.DATABASE_PORT || '3306', 10),
        user: process.env.DATABASE_USER ?? 'huckleberry_app',
        password: process.env.DATABASE_PASSWORD ?? '',
        database: process.env.DATABASE_NAME ?? 'huckleberry',
        ssl: { rejectUnauthorized: true },
      },
  verbose: true,
  strict: true,
});
