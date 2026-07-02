import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { IdentityService } from './identity.service.js';
import { DomoProxyService } from '../domo-proxy/domo-proxy.service.js';
import { SessionAuthGuard } from '../common/auth/session-auth.guard.js';
import type { HuckleberryPrincipal } from '../auth/types.js';
import type { DomoUser } from '../common/types/people.types.js';

@ApiTags('Identity')
@Controller('identity')
@UseGuards(SessionAuthGuard)
export class IdentityController {
  constructor(
    private readonly identityService: IdentityService,
    private readonly domo: DomoProxyService,
  ) {}

  @Get('')
  getIdentity(@Req() req: Request & { user?: HuckleberryPrincipal }) {
    if (!req.user) {
      throw new Error(
        'no huckleberry session — Domo linkage requires a magic-link sign-in',
      );
    }
    if (req.user.userId === 'dev-token-user') {
      return this.domo.get<DomoUser>('/api/content/v3/users/me');
    }
    return this.identityService.getIdentity(req.user);
  }
}
