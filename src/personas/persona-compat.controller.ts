import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PersonasService } from './personas.service.js';
import { DomoAuthGuard } from '../common/guards/domo-auth.guard.js';

/**
 * Backward-compatible persona routes matching the frontend's storage.ts:
 *   GET  /api/persona/:userId
 *   POST /api/persona/:userId
 *
 * These map userId-based requests to the personas CRUD store.
 */
@ApiTags('Personas')
@Controller('persona')
@UseGuards(DomoAuthGuard)
export class PersonaCompatController {
  constructor(private readonly personasService: PersonasService) {}

  @Get(':userId')
  findByUserId(@Param('userId') userId: string) {
    return this.personasService.findByUserId(userId) ?? null;
  }

  @Post(':userId')
  saveForUser(@Param('userId') userId: string, @Body() body: any) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return this.personasService.saveForUser(userId, body);
  }
}
