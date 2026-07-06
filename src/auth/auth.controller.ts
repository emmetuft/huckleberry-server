import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service.js';
import { RequestSigninDto } from './dto/request-signin.dto.js';
import { SignupDto } from './dto/signup.dto.js';
import { SessionService } from './session.service.js';
import { SignupService } from './signup.service.js';
import { USER_REPOSITORY, type UserRepository } from './user.repository.js';
import type { HuckleberryPrincipal } from './types.js';
import { SessionAuthGuard } from '../common/auth/session-auth.guard.js';
import { Public } from '../common/auth/decorators/public.decorator.js';
import { DomoLinkService } from '../common/auth/domo-link/domo-link.service.js';
import { AuthRateLimitGuard } from './guards/throttler.guard.js';

const SESSION_COOKIE = 'hb_session';
const CSRF_COOKIE = 'csrf_token';

@ApiTags('Auth')
@Controller('auth')
@UseGuards(SessionAuthGuard)
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly auth: AuthService,
    private readonly signup: SignupService,
    private readonly sessions: SessionService,
    private readonly link: DomoLinkService,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
  ) {}

  /**
   * Sign-up: provisions a Domo instance + user via the InstanceProvisioner,
   * creates the huckleberry user row in `pending_link` status, seeds a
   * pending Domo-link row, and sends a magic-link email. On first sign-in
   * the user completes the PKCE auth-code flow to mint the refresh token.
   *
   * If the email already exists this is a no-op (existence-oracle
   * protection — returns 202 either way).
   */
  @Public()
  @Post('signup')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(AuthRateLimitGuard)
  async signupRequest(
    @Body() dto: SignupDto,
    @Req() req: Request,
  ): Promise<{ status: 'accepted' }> {
    const ip = readClientIp(req);
    await this.signup.ensureUser(dto.email, {
      path: dto.path,
      instanceUrl: dto.instanceUrl,
    });
    // Fire-and-forget: both known and unknown email paths return at the same
    // point in time (after ensureUser), preventing timing-based email enumeration.
    this.auth
      .requestMagicLink(dto.email, ip)
      .catch((err: unknown) => this.logger.error(err));
    return { status: 'accepted' };
  }

  /**
   * Sign-in: sends a magic-link only if a user with this email already
   * exists. Does NOT provision instances or create accounts — that's
   * `POST /auth/signup` only. Always returns 202 regardless of whether
   * the user exists (existence-oracle protection).
   */
  @Public()
  @Post('signin/request')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(AuthRateLimitGuard)
  requestSignin(
    @Body() dto: RequestSigninDto,
    @Req() req: Request,
  ): { status: 'accepted' } {
    // Fire-and-forget: both known and unknown email paths return immediately,
    // preventing timing-based email enumeration.
    this.auth
      .requestMagicLink(dto.email, readClientIp(req))
      .catch((err: unknown) => this.logger.error(err));
    return { status: 'accepted' };
  }

  @Public()
  @Get('signin')
  @Throttle({ consume: {} })
  async consumeSignin(
    @Query('token') token: string | string[] | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ userId: string; needsLinkage: boolean }> {
    if (typeof token !== 'string') {
      throw new BadRequestException('invalid_or_expired_token');
    }
    const { user, needsLinkage } = await this.auth.consumeMagicLink(token);
    const issued = await this.sessions.issue(user.id);

    res.cookie(SESSION_COOKIE, issued.cookieValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      expires: issued.expiresAt,
    });
    // CSRF cookie is NOT HttpOnly — the SPA reads it and echoes it as X-CSRF-Token.
    res.cookie(CSRF_COOKIE, issued.csrfToken, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      expires: issued.expiresAt,
    });

    return { userId: user.id, needsLinkage };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() req: Request & { user?: HuckleberryPrincipal },
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    if (req.user) {
      await this.link.unlink(req.user.userId);
      await this.sessions.revoke(req.user.sessionId);
    }
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.clearCookie(CSRF_COOKIE, { path: '/' });
  }

  @Get('me')
  async me(@Req() req: Request & { user: HuckleberryPrincipal }): Promise<{
    id: string;
    email: string;
    status: string;
    displayName: string | null;
  }> {
    if (req.user.userId === 'dev-token-user') {
      return {
        id: 'dev-token-user',
        email: 'dev@localhost',
        status: 'active',
        displayName: 'Dev Token User',
      };
    }
    const user = await this.users.findById(req.user.userId);
    if (!user) throw new Error('user disappeared mid-session');
    return {
      id: user.id,
      email: user.email,
      status: user.status,
      displayName: user.displayName,
    };
  }
}

function readClientIp(req: Request): string | null {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string') return xff.split(',')[0].trim();
  return req.socket?.remoteAddress ?? null;
}
