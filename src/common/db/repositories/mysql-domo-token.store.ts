import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { DomoOAuthTokens } from '../../auth/domo-link/types.js';
import type { DomoTokenStore } from '../../auth/domo-link/token.store.js';
import { DRIZZLE, type Db } from '../db.module.js';
import { domoOauthTokens } from '../schema.js';
import { binaryToUuid, uuidToBinary } from '../uuid.js';
import { EnvelopeEncryptionService } from '../../crypto/envelope-encryption.service.js';

type TokenRow = typeof domoOauthTokens.$inferSelect;

@Injectable()
export class MysqlDomoTokenStore implements DomoTokenStore {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly crypto: EnvelopeEncryptionService,
  ) {}

  async get(linkId: string): Promise<DomoOAuthTokens | null> {
    const rows = await this.db
      .select()
      .from(domoOauthTokens)
      .where(eq(domoOauthTokens.linkId, uuidToBinary(linkId)))
      .limit(1);
    if (!rows[0]) return null;
    return this.fromRow(rows[0]);
  }

  async upsert(record: DomoOAuthTokens): Promise<DomoOAuthTokens> {
    const idBin = uuidToBinary(record.linkId);
    const encrypted = await this.crypto.encrypt(record.refreshToken);

    await this.db
      .insert(domoOauthTokens)
      .values({
        linkId: idBin,
        refreshToken: encrypted.ciphertext,
        refreshIv: encrypted.iv,
        refreshDekId: encrypted.dekId,
        scope: record.scope,
        updatedAt: record.updatedAt,
      })
      .onDuplicateKeyUpdate({
        set: {
          refreshToken: sql`VALUES(refresh_token)`,
          refreshIv: sql`VALUES(refresh_iv)`,
          refreshDekId: sql`VALUES(refresh_dek_id)`,
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

  private async fromRow(row: TokenRow): Promise<DomoOAuthTokens> {
    let refreshToken: string;
    if (row.refreshDekId === null || row.refreshIv === null) {
      // Pre-migration row: refresh_token is still plaintext.
      refreshToken = row.refreshToken;
    } else {
      refreshToken = await this.crypto.decrypt({
        ciphertext: row.refreshToken,
        iv: row.refreshIv,
        dekId: row.refreshDekId,
      });
    }
    return {
      linkId: binaryToUuid(row.linkId),
      refreshToken,
      scope: row.scope,
      updatedAt: row.updatedAt,
    };
  }
}
