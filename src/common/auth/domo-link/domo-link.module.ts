import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomoLinkController } from './domo-link.controller.js';
import { DomoLinkService } from './domo-link.service.js';
import { DomoOAuthClient } from './domo-oauth.client.js';
import { DomoAuthBroker } from './domo-auth.broker.js';
import { OAuthClientMetadataController } from './oauth-client-metadata.controller.js';
import { LINK_REPOSITORY, InMemoryLinkRepository } from './link.repository.js';
import { DOMO_TOKEN_STORE, InMemoryDomoTokenStore } from './token.store.js';
import {
  OAUTH_STATE_STORE,
  InMemoryOAuthStateStore,
} from './oauth-state.store.js';
import {
  INSTANCE_PROVISIONER,
  DevStubInstanceProvisioner,
} from './instance-provisioner.service.js';
import { DbModule, DRIZZLE, type Db } from '../../db/db.module.js';
import { MysqlLinkRepository } from '../../db/repositories/mysql-link.repository.js';
import { MysqlDomoTokenStore } from '../../db/repositories/mysql-domo-token.store.js';
import { EnvelopeEncryptionService } from '../../crypto/envelope-encryption.service.js';
import type { AppConfig } from '../../config/configuration.js';

/**
 * Layer B wiring.
 *
 * `LinkRepository` and `DomoTokenStore` swap to MySQL-backed impls when
 * `DATABASE_URL` is set (so a BFF restart preserves the user's link + refresh
 * token). The `OAuthStateStore` stays in-memory — the rows live ~10 minutes
 * and don't need to survive a restart.
 */
@Global()
@Module({
  imports: [DbModule],
  controllers: [DomoLinkController, OAuthClientMetadataController],
  providers: [
    DomoLinkService,
    DomoOAuthClient,
    DomoAuthBroker,
    EnvelopeEncryptionService,
    {
      provide: LINK_REPOSITORY,
      inject: [ConfigService, DRIZZLE],
      useFactory: (config: ConfigService, db: Db | null) =>
        useMysql(config) && db
          ? new MysqlLinkRepository(db)
          : new InMemoryLinkRepository(),
    },
    {
      provide: DOMO_TOKEN_STORE,
      inject: [ConfigService, DRIZZLE, EnvelopeEncryptionService],
      useFactory: (
        config: ConfigService,
        db: Db | null,
        crypto: EnvelopeEncryptionService,
      ) =>
        useMysql(config) && db
          ? new MysqlDomoTokenStore(db, crypto)
          : new InMemoryDomoTokenStore(),
    },
    { provide: OAUTH_STATE_STORE, useClass: InMemoryOAuthStateStore },
    { provide: INSTANCE_PROVISIONER, useClass: DevStubInstanceProvisioner },
  ],
  exports: [
    DomoLinkService,
    DomoOAuthClient,
    DomoAuthBroker,
    LINK_REPOSITORY,
    DOMO_TOKEN_STORE,
    OAUTH_STATE_STORE,
    INSTANCE_PROVISIONER,
  ],
})
export class DomoLinkModule {}

function useMysql(config: ConfigService): boolean {
  const app = config.get<AppConfig>('app');
  return !!(app?.databaseUrl || app?.databaseHost);
}
