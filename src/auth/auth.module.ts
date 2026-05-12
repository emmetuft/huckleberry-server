import { Global, Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { SessionService } from './session.service.js';
import {
  USER_REPOSITORY,
  InMemoryUserRepository,
} from './user.repository.js';
import {
  MAGIC_LINK_REPOSITORY,
  InMemoryMagicLinkRepository,
} from './magic-link.repository.js';
import {
  SESSION_REPOSITORY,
  InMemorySessionRepository,
} from './session.repository.js';
import { EMAIL_SERVICE, ConsoleEmailService } from './email.service.js';
import { HuckleberryAuthGuard } from '../common/auth/huckleberry-auth.guard.js';

/**
 * Layer A wiring — magic-link sign-in + session.
 *
 * Repositories are bound to in-memory impls today. Swap to Aurora-backed
 * impls when `TenantBoundConnection` lands by changing only the provider
 * useClass values; no consumer needs to change.
 *
 * EmailService is bound to a console-logging impl in dev. The SES impl
 * lives behind the same interface and is selected post-MVP.
 */
@Global()
@Module({
  controllers: [AuthController, AdminController],
  providers: [
    AuthService,
    SessionService,
    HuckleberryAuthGuard,
    { provide: USER_REPOSITORY, useClass: InMemoryUserRepository },
    { provide: MAGIC_LINK_REPOSITORY, useClass: InMemoryMagicLinkRepository },
    { provide: SESSION_REPOSITORY, useClass: InMemorySessionRepository },
    { provide: EMAIL_SERVICE, useClass: ConsoleEmailService },
  ],
  exports: [
    AuthService,
    SessionService,
    HuckleberryAuthGuard,
    USER_REPOSITORY,
    MAGIC_LINK_REPOSITORY,
    SESSION_REPOSITORY,
    EMAIL_SERVICE,
  ],
})
export class HuckleberryAuthModule {}
