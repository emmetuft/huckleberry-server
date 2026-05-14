import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminController } from './admin.controller.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { SessionService } from './session.service.js';
import { SignupService } from './signup.service.js';
import { USER_REPOSITORY, InMemoryUserRepository } from './user.repository.js';
import {
  MAGIC_LINK_REPOSITORY,
  InMemoryMagicLinkRepository,
} from './magic-link.repository.js';
import {
  SESSION_REPOSITORY,
  InMemorySessionRepository,
} from './session.repository.js';
import {
  EMAIL_SERVICE,
  ConsoleEmailService,
  SmtpEmailService,
} from './email.service.js';
import { HuckleberryAuthGuard } from '../common/auth/huckleberry-auth.guard.js';
import { DbModule, DRIZZLE, type Db } from '../common/db/db.module.js';
import { MysqlUserRepository } from '../common/db/repositories/mysql-user.repository.js';
import { MysqlMagicLinkRepository } from '../common/db/repositories/mysql-magic-link.repository.js';
import { MysqlSessionRepository } from '../common/db/repositories/mysql-session.repository.js';
import type { AppConfig } from '../common/config/configuration.js';

/**
 * Layer A wiring — magic-link sign-in + session.
 *
 * Repositories pick MySQL when `DATABASE_URL` is set (so the BFF can boot
 * against `pnpm infra:up`), and fall back to the in-memory MVP impls otherwise
 * (so tests + zero-config local dev keep working).
 */
@Global()
@Module({
  imports: [DbModule],
  controllers: [AuthController, AdminController],
  providers: [
    AuthService,
    SessionService,
    SignupService,
    HuckleberryAuthGuard,
    {
      provide: USER_REPOSITORY,
      inject: [ConfigService, DRIZZLE],
      useFactory: (config: ConfigService, db: Db | null) =>
        useMysql(config) && db
          ? new MysqlUserRepository(db)
          : new InMemoryUserRepository(),
    },
    {
      provide: MAGIC_LINK_REPOSITORY,
      inject: [ConfigService, DRIZZLE],
      useFactory: (config: ConfigService, db: Db | null) =>
        useMysql(config) && db
          ? new MysqlMagicLinkRepository(db)
          : new InMemoryMagicLinkRepository(),
    },
    {
      provide: SESSION_REPOSITORY,
      inject: [ConfigService, DRIZZLE],
      useFactory: (config: ConfigService, db: Db | null) =>
        useMysql(config) && db
          ? new MysqlSessionRepository(db)
          : new InMemorySessionRepository(),
    },
    {
      provide: EMAIL_SERVICE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        useSmtp(config)
          ? new SmtpEmailService(config)
          : new ConsoleEmailService(),
    },
  ],
  exports: [
    AuthService,
    SessionService,
    SignupService,
    HuckleberryAuthGuard,
    USER_REPOSITORY,
    MAGIC_LINK_REPOSITORY,
    SESSION_REPOSITORY,
    EMAIL_SERVICE,
  ],
})
export class HuckleberryAuthModule {}

function useMysql(config: ConfigService): boolean {
  const app = config.get<AppConfig>('app');
  return !!app?.databaseUrl;
}

function useSmtp(config: ConfigService): boolean {
  const app = config.get<AppConfig>('app');
  return !!app?.smtpHost;
}
