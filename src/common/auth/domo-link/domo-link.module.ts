import { Global, Module } from '@nestjs/common';
import { DomoLinkController } from './domo-link.controller.js';
import { DomoLinkService } from './domo-link.service.js';
import { DomoOAuthClient } from './domo-oauth.client.js';
import { DomoAuthBroker } from './domo-auth.broker.js';
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

/**
 * Layer B wiring. Same in-memory-repo + drop-in-Aurora-later pattern as
 * Layer A. `DomoAuthBroker` is exported so `DomoProxyService` can pull a
 * per-user Bearer per request.
 */
@Global()
@Module({
  controllers: [DomoLinkController],
  providers: [
    DomoLinkService,
    DomoOAuthClient,
    DomoAuthBroker,
    { provide: LINK_REPOSITORY, useClass: InMemoryLinkRepository },
    { provide: DOMO_TOKEN_STORE, useClass: InMemoryDomoTokenStore },
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
