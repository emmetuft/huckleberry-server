import { Global, Module } from '@nestjs/common';
import { GatekeeperAuthGuard } from './gatekeeper-auth.guard.js';
import { JwksService } from './jwks.service.js';
import { KnownTenantsService } from './known-tenants.service.js';

/**
 * Global auth module — exposes the JWKS client, tenant resolver, and
 * `GatekeeperAuthGuard` for any controller that wants `@UseGuards(...)`.
 * Wiring the guard globally (via `APP_GUARD`) is intentionally deferred
 * until the `AUTH_PROVIDER=gatekeeper` switch flips; today controllers
 * still use `DomoAuthGuard` directly.
 */
@Global()
@Module({
  providers: [JwksService, KnownTenantsService, GatekeeperAuthGuard],
  exports: [JwksService, KnownTenantsService, GatekeeperAuthGuard],
})
export class AuthModule {}
