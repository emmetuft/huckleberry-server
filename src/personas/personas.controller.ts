import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PersonasService } from './personas.service.js';
import { CreatePersonaDto } from './dto/create-persona.dto.js';
import { UpdatePersonaDto } from './dto/update-persona.dto.js';
import { DomoAuthGuard } from '../common/guards/domo-auth.guard.js';

@ApiTags('Personas')
@Controller('personas')
@UseGuards(DomoAuthGuard)
export class PersonasController {
  constructor(private readonly personasService: PersonasService) {}

  @Get()
  findAll() {
    return this.personasService.findAll();
  }

  @Post()
  create(@Body() dto: CreatePersonaDto) {
    return this.personasService.create(dto);
  }

  @Get('default')
  findDefault() {
    return this.personasService.findDefault() ?? null;
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.personasService.findOne(id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePersonaDto) {
    return this.personasService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.personasService.remove(id);
  }

  @Patch(':id/default')
  setDefault(@Param('id') id: string) {
    return this.personasService.setDefault(id);
  }
}
