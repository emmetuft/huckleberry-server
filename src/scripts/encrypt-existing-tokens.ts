/**
 * One-time migration: encrypt all plaintext refresh tokens in domo_oauth_tokens.
 *
 * Run ONCE after deploying the schema migration (0005_volatile_wild_child.sql)
 * and before enabling any enforcement that requires encrypted tokens.
 *
 * Usage:
 *   DATABASE_URL=mysql://... DEV_ENCRYPTION_KEY=<hex> tsx src/scripts/encrypt-existing-tokens.ts
 *   DATABASE_HOST=... KMS_KEY_ARN=arn:... tsx src/scripts/encrypt-existing-tokens.ts
 *
 * The script is idempotent: rows with a non-null refresh_dek_id are skipped.
 */

import { drizzle } from 'drizzle-orm/mysql2';
import { createPool, type Pool } from 'mysql2/promise';
import { isNull, eq } from 'drizzle-orm';
import { Signer } from '@aws-sdk/rds-signer';
import { ConfigService } from '@nestjs/config';
import configuration from '../common/config/configuration.js';
import { domoOauthTokens } from '../common/db/schema.js';
import { EnvelopeEncryptionService } from '../common/crypto/envelope-encryption.service.js';
import { binaryToUuid } from '../common/db/uuid.js';

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
  const user = process.env.DATABASE_USER ?? 'huckleberry_app';
  const database = process.env.DATABASE_NAME ?? 'huckleberry';

  let pool: Pool;
  if (url) {
    pool = createPool({ uri: url, connectionLimit: 5 });
  } else {
    const signer = new Signer({
      region: process.env.AWS_REGION ?? 'us-east-1',
      hostname: host,
      port,
      username: user,
    });
    pool = createPool({
      host,
      port,
      user,
      database,
      password: (() => signer.getAuthToken()) as unknown as string,
      ssl: { rejectUnauthorized: true },
      connectionLimit: 5,
    });
  }

  const db = drizzle(pool);

  const cfg = configuration();
  const configService = {
    get: (_key: string) => cfg.app,
  } as unknown as ConfigService;
  const crypto = new EnvelopeEncryptionService(configService);

  const rows = await db
    .select()
    .from(domoOauthTokens)
    .where(isNull(domoOauthTokens.refreshDekId));

  console.log(`Found ${rows.length} plaintext row(s) to encrypt.`);
  if (rows.length === 0) {
    await pool.end();
    return;
  }

  let encrypted = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const encVal = await crypto.encrypt(row.refreshToken);
      await db
        .update(domoOauthTokens)
        .set({
          refreshToken: encVal.ciphertext,
          refreshIv: encVal.iv,
          refreshDekId: encVal.dekId,
        })
        .where(eq(domoOauthTokens.linkId, row.linkId));
      encrypted++;
    } catch (err) {
      console.error(`Failed to encrypt row ${binaryToUuid(row.linkId)}:`, err);
      failed++;
    }
  }

  console.log(`Done. Encrypted: ${encrypted}, Failed: ${failed}.`);
  await pool.end();

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
