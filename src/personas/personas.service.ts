import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Persona } from '../common/types/persona.types.js';
import type { CreatePersonaDto } from './dto/create-persona.dto.js';
import type { UpdatePersonaDto } from './dto/update-persona.dto.js';

@Injectable()
export class PersonasService {
  private readonly logger = new Logger(PersonasService.name);
  private readonly store = new Map<string, Persona>();
  /** Maps userId -> persona ID for the legacy /persona/:userId route */
  private readonly userPersonaMap = new Map<string, string>();

  findAll(): Persona[] {
    return Array.from(this.store.values());
  }

  findOne(id: string): Persona {
    const persona = this.store.get(id);
    if (!persona) throw new NotFoundException(`Persona ${id} not found`);
    return persona;
  }

  findDefault(): Persona | undefined {
    return this.findAll().find((p) => p.isDefault);
  }

  /**
   * Find the persona associated with a userId.
   * Falls back to the default persona if no mapping exists.
   */
  findByUserId(userId: string): Persona | undefined {
    const personaId = this.userPersonaMap.get(userId);
    if (personaId) {
      return this.store.get(personaId);
    }
    return this.findDefault();
  }

  /**
   * Save/update a persona for a specific user.
   * If the user already has a persona, update it. Otherwise, create one.
   */
  saveForUser(
    userId: string,
    data: Omit<
      Persona,
      'id' | 'isDefault' | 'createdAt' | 'updatedAt' | 'name'
    >,
  ): Persona {
    const existingId = this.userPersonaMap.get(userId);
    const now = new Date().toISOString();

    if (existingId && this.store.has(existingId)) {
      const existing = this.store.get(existingId);
      const updated: Persona = {
        ...existing,
        ...data,
        id: existing.id,
        name: existing.name,
        isDefault: existing.isDefault,
        createdAt: existing.createdAt,
        updatedAt: now,
      };
      this.store.set(existingId, updated);
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
    this.store.set(persona.id, persona);
    this.userPersonaMap.set(userId, persona.id);
    this.logger.log(`Created persona ${persona.id} for user ${userId}`);
    return persona;
  }

  create(dto: CreatePersonaDto): Persona {
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
      isDefault: false,
      usePersona: dto.usePersona ?? true,
      useActivity: dto.useActivity ?? true,
      useData: dto.useData ?? true,
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(persona.id, persona);
    this.logger.log(`Created persona ${persona.id}: ${persona.name}`);
    return persona;
  }

  update(id: string, dto: UpdatePersonaDto): Persona {
    const existing = this.findOne(id);
    const updated: Persona = {
      ...existing,
      ...Object.fromEntries(
        Object.entries(dto).filter(([, v]) => v !== undefined),
      ),
      id: existing.id,
      isDefault: existing.isDefault,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    this.store.set(id, updated);
    return updated;
  }

  remove(id: string): void {
    if (!this.store.has(id)) {
      throw new NotFoundException(`Persona ${id} not found`);
    }
    this.store.delete(id);
  }

  setDefault(id: string): Persona {
    const persona = this.findOne(id);
    for (const p of this.store.values()) {
      if (p.isDefault) {
        this.store.set(p.id, { ...p, isDefault: false });
      }
    }
    const updated = {
      ...persona,
      isDefault: true,
      updatedAt: new Date().toISOString(),
    };
    this.store.set(id, updated);
    return updated;
  }

  /**
   * Serialize a persona into a prompt-friendly string for injection
   * into the Huckleberry system prompt.
   */
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
