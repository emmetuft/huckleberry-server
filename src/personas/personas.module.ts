import { Module } from '@nestjs/common';
import { PersonasController } from './personas.controller.js';
import { PersonaCompatController } from './persona-compat.controller.js';
import { PersonasService } from './personas.service.js';

@Module({
  controllers: [PersonasController, PersonaCompatController],
  providers: [PersonasService],
  exports: [PersonasService],
})
export class PersonasModule {}
