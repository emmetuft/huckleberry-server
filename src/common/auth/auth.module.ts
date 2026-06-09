import { Global, Module } from '@nestjs/common';
import { GatekeeperAuthGuard } from './gatekeeper-auth.guard.js';
import { JwksService } from './jwks.service.js';
import { KnownTenantsService } from './known-tenants.service.js';

/**
 * Global auth module — exposes the JWKS client, tenant resolver, and
 * `GatekeeperAuthGuard` for controllers that want `@UseGuards(...)`.
 */
@Global()
@Module({
  providers: [JwksService, KnownTenantsService, GatekeeperAuthGuard],
  exports: [JwksService, KnownTenantsService, GatekeeperAuthGuard],
})
export class AuthModule {}
