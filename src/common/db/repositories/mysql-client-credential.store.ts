import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type {
  ClientCredentialStore,
  OAuthClientCredentials,
} from '../../auth/domo-link/client-credential.store.js';
import { DRIZZLE, type Db } from '../db.module.js';
import { domoOauthClients } from '../schema.js';

type ClientRow = typeof domoOauthClients.$inferSelect;

function fromRow(row: ClientRow): OAuthClientCredentials {
  return {
    issuerUrl: row.issuerUrl,
    clientId: row.clientId,
    registrationAccessToken: row.registrationAccessToken,
    redirectUri: row.redirectUri,
    scope: row.scope,
    registeredAt: row.registeredAt,
    lastUsedAt: row.lastUsedAt,
  };
}

@Injectable()
export class MysqlClientCredentialStore implements ClientCredentialStore {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async get(issuerUrl: string): Promise<OAuthClientCredentials | null> {
    const rows = await this.db
      .select()
      .from(domoOauthClients)
      .where(eq(domoOauthClients.issuerUrl, issuerUrl))
      .limit(1);
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async upsert(
    record: OAuthClientCredentials,
  ): Promise<OAuthClientCredentials> {
    await this.db
      .insert(domoOauthClients)
      .values({
        issuerUrl: record.issuerUrl,
        clientId: record.clientId,
        registrationAccessToken: record.registrationAccessToken,
        redirectUri: record.redirectUri,
        scope: record.scope,
        registeredAt: record.registeredAt,
        lastUsedAt: record.lastUsedAt,
      })
      .onDuplicateKeyUpdate({
        set: {
          clientId: sql`VALUES(client_id)`,
          registrationAccessToken: sql`VALUES(registration_access_token)`,
          redirectUri: sql`VALUES(redirect_uri)`,
          scope: sql`VALUES(scope)`,
          lastUsedAt: sql`VALUES(last_used_at)`,
        },
      });
    return record;
  }

  async delete(issuerUrl: string): Promise<void> {
    await this.db
      .delete(domoOauthClients)
      .where(eq(domoOauthClients.issuerUrl, issuerUrl));
  }

  async touchLastUsed(issuerUrl: string): Promise<void> {
    await this.db
      .update(domoOauthClients)
      .set({ lastUsedAt: new Date() })
      .where(eq(domoOauthClients.issuerUrl, issuerUrl));
  }
}
