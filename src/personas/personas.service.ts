import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Persona } from '../common/types/persona.types.js';
import type { CreatePersonaDto } from './dto/create-persona.dto.js';
import type { UpdatePersonaDto } from './dto/update-persona.dto.js';
import {
  PERSONA_REPOSITORY,
  type PersonaRepository,
} from './persona.repository.js';
import { domoRequestContext } from '../common/auth/domo-request-context.js';

@Injectable()
export class PersonasService {
  private readonly logger = new Logger(PersonasService.name);

  constructor(
    @Inject(PERSONA_REPOSITORY) private readonly repo: PersonaRepository,
  ) {}

  private tenant(): { customerId: string; userId: string } {
    const ctx = domoRequestContext.getStore();
    if (!ctx)
      throw new Error('No request context — is DomoContextInterceptor active?');
    return { customerId: ctx.customerId, userId: ctx.userId };
  }

  async findAll(): Promise<Persona[]> {
    const { customerId, userId } = this.tenant();
    return this.repo.findAll(customerId, userId);
  }

  async findOne(id: string): Promise<Persona> {
    const { customerId, userId } = this.tenant();
    const persona = await this.repo.findOne(customerId, userId, id);
    if (!persona) throw new NotFoundException(`Persona ${id} not found`);
    return persona;
  }

  async findDefault(): Promise<Persona | undefined> {
    const { customerId, userId } = this.tenant();
    return (await this.repo.findDefault(customerId, userId)) ?? undefined;
  }

  async findByUserId(): Promise<Persona | undefined> {
    const { customerId, userId } = this.tenant();
    const defaultPersona = await this.repo.findDefault(customerId, userId);
    if (defaultPersona) return defaultPersona;
    const all = await this.repo.findAll(customerId, userId);
    return all[0];
  }

  async saveForUser(
    data: Omit<
      Persona,
      'id' | 'isDefault' | 'createdAt' | 'updatedAt' | 'name'
    >,
  ): Promise<Persona> {
    const { customerId, userId } = this.tenant();
    const existing = await this.repo.findAll(customerId, userId);
    const first = existing[0];
    const now = new Date().toISOString();

    if (first) {
      const updated = await this.repo.update(
        customerId,
        userId,
        first.id,
        data,
      );
      if (!updated)
        throw new NotFoundException(`Persona ${first.id} not found`);
      return updated;
    }

    const persona: Persona = {
      id: randomUUID(),
      name: `User ${userId}`,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
      ...data,
    };
    await this.repo.create(customerId, userId, persona);
    this.logger.log(`Created persona ${persona.id} for user ${userId}`);
    return persona;
  }

  async create(dto: CreatePersonaDto): Promise<Persona> {
    const { customerId, userId } = this.tenant();
    const now = new Date().toISOString();
    const persona: Persona = {
      id: randomUUID(),
      name: dto.name,
      role: dto.role,
      level: dto.level,
      department: dto.department,
      team: dto.team,
      focusAreas: dto.focusAreas,
      strengths: dto.strengths,
      weaknesses: dto.weaknesses,
      goals: dto.goals,
      skills: dto.skills ?? [],
      tools: dto.tools ?? [],
      relationships: dto.relationships ?? [],
      communicationStyle: dto.communicationStyle ?? null,
      domainKnowledge: dto.domainKnowledge ?? [],
      isDefault: false,
      usePersona: dto.usePersona ?? true,
      useActivity: dto.useActivity ?? true,
      useData: dto.useData ?? true,
      createdAt: now,
      updatedAt: now,
    };
    await this.repo.create(customerId, userId, persona);
    this.logger.log(`Created persona ${persona.id}: ${persona.name}`);
    return persona;
  }

  async update(id: string, dto: UpdatePersonaDto): Promise<Persona> {
    const { customerId, userId } = this.tenant();
    const updated = await this.repo.update(customerId, userId, id, dto);
    if (!updated) throw new NotFoundException(`Persona ${id} not found`);
    return updated;
  }

  async remove(id: string): Promise<void> {
    const { customerId, userId } = this.tenant();
    const deleted = await this.repo.remove(customerId, userId, id);
    if (!deleted) throw new NotFoundException(`Persona ${id} not found`);
  }

  async setDefault(id: string): Promise<Persona> {
    const { customerId, userId } = this.tenant();
    const result = await this.repo.setDefault(customerId, userId, id);
    if (!result) throw new NotFoundException(`Persona ${id} not found`);
    return result;
  }

  toPromptString(persona: Persona): string {
    const lines = [
      `Role: ${persona.role} (${persona.level || 'N/A'})`,
      `Department: ${persona.department}${persona.team ? ` | Team: ${persona.team}` : ''}`,
      `Focus Areas: ${persona.focusAreas.join(', ')}`,
      `Strengths: ${persona.strengths.join(', ')}`,
      `Goals: ${persona.goals}`,
    ];
    return lines.join('\n');
  }
}
