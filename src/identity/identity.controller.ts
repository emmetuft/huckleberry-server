import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { IdentityService } from './identity.service.js';
import { DomoAuthGuard } from '../common/guards/domo-auth.guard.js';
import type { HuckleberryPrincipal } from '../auth/types.js';

@ApiTags('Identity')
@Controller('identity')
@UseGuards(DomoAuthGuard)
export class IdentityController {
  constructor(private readonly identityService: IdentityService) {}

  @Get('')
  getIdentity(@Req() req: Request & { user?: HuckleberryPrincipal }) {
    if (!req.user) {
      throw new Error(
        'no huckleberry session — Domo linkage requires a magic-link sign-in',
      );
    }
    return this.identityService.getIdentity(req.user);
  }
}
