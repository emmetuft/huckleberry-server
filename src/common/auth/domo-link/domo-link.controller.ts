import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { IsOptional, IsUrl, MaxLength } from 'class-validator';
import type { AppConfig } from '../../config/configuration.js';
import { SessionAuthGuard } from '../session-auth.guard.js';
import { DomoLinkService } from './domo-link.service.js';
import type { HuckleberryPrincipal } from '../../../auth/types.js';

class StartLinkDto {
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(255)
  issuerUrl?: string;
}

/**
 * Layer B endpoints. All gated by the huckleberry session (the user is
 * already signed in via magic-link).
 *
 *   POST /api/auth/domo/link/start
 *     Body: { issuerUrl? }
 *     → { authorizeUrl }  — SPA does `window.location.href = authorizeUrl`
 *
 *   GET  /api/auth/domo/callback?code&state
 *     Browser leg — Gatekeeper redirects here. Exchanges code → tokens,
 *     persists the link, then 302s the user into the app.
 *
 *   GET  /api/auth/domo/links
 *     → { link: LinkedDomoInstance | null }
 */
@ApiTags('Auth — Domo linkage')
@Controller('auth/domo')
@UseGuards(SessionAuthGuard)
export class DomoLinkController {
  private readonly successRedirect: string;
  private readonly failureRedirect: string;

  constructor(
    config: ConfigService,
    private readonly link: DomoLinkService,
  ) {
    const app = config.get<AppConfig>('app');
    const base = app?.magicLinkBaseUrl ?? 'http://localhost:5173';
    this.successRedirect = `${base.replace(/\/+$/, '')}/workspace?linked=1`;
    this.failureRedirect = `${base.replace(/\/+$/, '')}/login?linkError=1`;
  }

  @Post('link/start')
  @HttpCode(HttpStatus.OK)
  async start(
    @Req() req: Request & { user: HuckleberryPrincipal },
    @Body() dto: StartLinkDto,
  ): Promise<{ authorizeUrl: string }> {
    const { authorizeUrl } = await this.link.startLink(
      req.user.userId,
      dto.issuerUrl,
    );
    return { authorizeUrl };
  }

  @Get('callback')
  async callback(
    @Req() req: Request & { user: HuckleberryPrincipal },
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') errorParam: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (errorParam || !code || !state) {
      return res.redirect(this.failureRedirect);
    }
    try {
      await this.link.completeLink({
        state,
        code,
        sessionUserId: req.user.userId,
      });
      return res.redirect(this.successRedirect);
    } catch (err) {
      const url = new URL(this.failureRedirect);
      url.searchParams.set('reason', toStableErrorCode(err));
      return res.redirect(url.toString());
    }
  }

  @Get('links')
  async links(
    @Req() req: Request & { user: HuckleberryPrincipal },
  ): Promise<{ link: unknown }> {
    const link = await this.link.activeLinkFor(req.user.userId);
    return { link };
  }
}

const KNOWN_ERROR_CODES = new Set([
  'invalid_or_expired_state',
  'state_user_mismatch',
  'access_token_unverified',
  'access_token_malformed',
  'access_token_missing_cid_or_sub',
]);

function toStableErrorCode(err: unknown): string {
  const msg = err instanceof Error ? err.message : '';
  if (KNOWN_ERROR_CODES.has(msg)) return msg;
  return 'link_failed';
}
