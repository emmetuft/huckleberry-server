import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { DomoOAuthTokens } from '../../auth/domo-link/types.js';
import type { DomoTokenStore } from '../../auth/domo-link/token.store.js';
import { DRIZZLE, type Db } from '../db.module.js';
import { domoOauthTokens } from '../schema.js';
import { binaryToUuid, uuidToBinary } from '../uuid.js';

type TokenRow = typeof domoOauthTokens.$inferSelect;

function fromRow(row: TokenRow): DomoOAuthTokens {
  return {
    linkId: binaryToUuid(row.linkId),
    refreshToken: row.refreshToken,
    scope: row.scope,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class MysqlDomoTokenStore implements DomoTokenStore {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async get(linkId: string): Promise<DomoOAuthTokens | null> {
    const rows = await this.db
      .select()
      .from(domoOauthTokens)
      .where(eq(domoOauthTokens.linkId, uuidToBinary(linkId)))
      .limit(1);
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async upsert(record: DomoOAuthTokens): Promise<DomoOAuthTokens> {
    // INSERT ... ON DUPLICATE KEY UPDATE — one row per link. Gatekeeper
    // rotates the refresh token on every use, so writes are frequent and
    // must overwrite atomically.
    const idBin = uuidToBinary(record.linkId);
    await this.db
      .insert(domoOauthTokens)
      .values({
        linkId: idBin,
        refreshToken: record.refreshToken,
        scope: record.scope,
        updatedAt: record.updatedAt,
      })
      .onDuplicateKeyUpdate({
        set: {
          refreshToken: sql`VALUES(refresh_token)`,
          scope: sql`VALUES(scope)`,
          updatedAt: sql`VALUES(updated_at)`,
        },
      });
    return record;
  }

  async delete(linkId: string): Promise<void> {
    await this.db
      .delete(domoOauthTokens)
      .where(eq(domoOauthTokens.linkId, uuidToBinary(linkId)));
  }
}
