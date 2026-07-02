import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { PersonasService } from './personas.service.js';
import { HuckleberryAuthGuard } from '../common/auth/huckleberry-auth.guard.js';
import type { HuckleberryPrincipal } from '../auth/types.js';

/**
 * Backward-compatible persona routes matching the frontend's storage.ts:
 *   GET  /api/persona
 *   POST /api/persona
 *
 * Identity is derived from the session — no :userId path param.
 */
@ApiTags('Personas')
@Controller('persona')
@UseGuards(HuckleberryAuthGuard)
export class PersonaCompatController {
  constructor(private readonly personasService: PersonasService) {}

  @Get()
  async findForCurrentUser(
    @Req() _req: Request & { user: HuckleberryPrincipal },
  ) {
    return (await this.personasService.findByUserId()) ?? null;
  }

  @Post()
  async saveForCurrentUser(
    @Req() _req: Request & { user: HuckleberryPrincipal },
    @Body() body: Record<string, unknown>,
  ) {
    return this.personasService.saveForUser(body as any);
  }
}
