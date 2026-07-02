import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PersonasService } from './personas.service.js';
import { DomoAuthGuard } from '../common/guards/domo-auth.guard.js';

/**
 * Backward-compatible persona routes matching the frontend's storage.ts:
 *   GET  /api/persona
 *   POST /api/persona
 *
 * Identity is derived from ALS context — no :userId path param.
 */
@ApiTags('Personas')
@Controller('persona')
@UseGuards(DomoAuthGuard)
export class PersonaCompatController {
  constructor(private readonly personasService: PersonasService) {}

  @Get()
  async findForCurrentUser() {
    return (await this.personasService.findByUserId()) ?? null;
  }

  @Post()
  async saveForCurrentUser(@Body() body: Record<string, unknown>) {
    return this.personasService.saveForUser(body as any);
  }
}
