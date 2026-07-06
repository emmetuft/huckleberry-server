import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Persona } from '../common/types/persona.types.js';
import { PersonasService } from './personas.service.js';
import { SessionAuthGuard } from '../common/auth/session-auth.guard.js';

/**
 * Backward-compatible persona routes matching the frontend's storage.ts:
 *   GET  /api/persona
 *   POST /api/persona
 *
 * Identity is derived from ALS context — no :userId path param.
 */
@ApiTags('Personas')
@Controller('persona')
@UseGuards(SessionAuthGuard)
export class PersonaCompatController {
  constructor(private readonly personasService: PersonasService) {}

  @Get()
  async findForCurrentUser() {
    return (await this.personasService.findByUserId()) ?? null;
  }

  @Post()
  async saveForCurrentUser(@Body() body: Partial<Persona>) {
    return this.personasService.saveForUser(body);
  }
}
