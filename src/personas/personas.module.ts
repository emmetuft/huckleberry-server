import { Module } from '@nestjs/common';
import { PersonasController } from './personas.controller.js';
import { PersonasService } from './personas.service.js';
import { PERSONA_REPOSITORY } from './persona.repository.js';
import { DRIZZLE, type Db } from '../common/db/db.module.js';
import { MysqlPersonaRepository } from '../common/db/repositories/mysql-persona.repository.js';

@Module({
  controllers: [PersonasController],
  providers: [
    PersonasService,
    {
      provide: PERSONA_REPOSITORY,
      inject: [DRIZZLE],
      useFactory: (db: Db) => new MysqlPersonaRepository(db),
    },
  ],
  exports: [PersonasService],
})
export class PersonasModule {}
