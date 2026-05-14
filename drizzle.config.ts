import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit config — used by `pnpm db:generate` (diff TS schema against
 * the last migration) and `pnpm db:push` / `db:migrate` (apply migrations).
 *
 * Migration SQL files live in `./drizzle/`. They're committed to the repo
 * and run by the same migrator at BFF boot in dev (programmatic) and by the
 * deploy-time runner in prod (`GET_LOCK('hb_migrate', 30)` per
 * docs/diagrams/aurora-integration.md).
 */
export default defineConfig({
  dialect: 'mysql',
  schema: './src/common/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      'mysql://huckleberry:huckleberry@localhost:3306/huckleberry',
  },
  // Target is MySQL 8.4 LTS (our Aurora cluster runs 8.4). Stick to the
  // 8.4 feature set — both the local container and Aurora enforce the
  // same reserved-word and deprecated-feature rules.
  verbose: true,
  strict: true,
});
