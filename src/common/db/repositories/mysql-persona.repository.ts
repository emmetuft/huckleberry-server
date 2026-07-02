import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type {
  Persona,
  PersonaCommunicationStyle,
  PersonaSkill,
} from '../../types/persona.types.js';
import type { PersonaRepository } from '../../../personas/persona.repository.js';
import { DRIZZLE, type Db } from '../db.module.js';
import { personas } from '../schema.js';
import { binaryToUuid, uuidToBinary } from '../uuid.js';

type PersonaRow = typeof personas.$inferSelect;

function fromRow(row: PersonaRow): Persona {
  return {
    id: binaryToUuid(row.id),
    name: row.name,
    role: row.role,
    level: row.level as Persona['level'],
    department: row.department,
    team: row.team ?? undefined,
    focusAreas: JSON.parse(row.focusAreas) as string[],
    strengths: JSON.parse(row.strengths) as string[],
    weaknesses: JSON.parse(row.weaknesses) as string[],
    goals: row.goals,
    skills: row.skills ? (JSON.parse(row.skills) as PersonaSkill[]) : [],
    tools: row.tools ? (JSON.parse(row.tools) as string[]) : [],
    relationships: row.relationships
      ? (JSON.parse(row.relationships) as string[])
      : [],
    communicationStyle: row.communicationStyle
      ? (JSON.parse(row.communicationStyle) as PersonaCommunicationStyle)
      : null,
    domainKnowledge: row.domainKnowledge
      ? (JSON.parse(row.domainKnowledge) as string[])
      : [],
    isDefault: row.isDefault === 1,
    usePersona: row.usePersona === 1,
    useActivity: row.useActivity === 1,
    useData: row.useData === 1,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class MysqlPersonaRepository implements PersonaRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async findAll(customerId: string, userId: string): Promise<Persona[]> {
    const rows = await this.db
      .select()
      .from(personas)
      .where(
        and(
          eq(personas.customerId, customerId),
          eq(personas.userId, uuidToBinary(userId)),
        ),
      );
    return rows.map(fromRow);
  }

  async findOne(
    customerId: string,
    userId: string,
    id: string,
  ): Promise<Persona | null> {
    const rows = await this.db
      .select()
      .from(personas)
      .where(
        and(
          eq(personas.id, uuidToBinary(id)),
          eq(personas.customerId, customerId),
          eq(personas.userId, uuidToBinary(userId)),
        ),
      )
      .limit(1);
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async findDefault(
    customerId: string,
    userId: string,
  ): Promise<Persona | null> {
    const rows = await this.db
      .select()
      .from(personas)
      .where(
        and(
          eq(personas.customerId, customerId),
          eq(personas.userId, uuidToBinary(userId)),
          eq(personas.isDefault, 1),
        ),
      )
      .limit(1);
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async create(
    customerId: string,
    userId: string,
    persona: Persona,
  ): Promise<Persona> {
    const now = new Date();
    await this.db.insert(personas).values({
      id: uuidToBinary(persona.id),
      customerId,
      userId: uuidToBinary(userId),
      name: persona.name,
      role: persona.role,
      level: persona.level || '',
      department: persona.department,
      team: persona.team ?? null,
      focusAreas: JSON.stringify(persona.focusAreas),
      strengths: JSON.stringify(persona.strengths),
      weaknesses: JSON.stringify(persona.weaknesses),
      goals: persona.goals,
      skills: JSON.stringify(persona.skills ?? []),
      tools: JSON.stringify(persona.tools ?? []),
      relationships: JSON.stringify(persona.relationships ?? []),
      communicationStyle: persona.communicationStyle
        ? JSON.stringify(persona.communicationStyle)
        : null,
      domainKnowledge: JSON.stringify(persona.domainKnowledge ?? []),
      isDefault: persona.isDefault ? 1 : 0,
      usePersona: persona.usePersona ? 1 : 0,
      useActivity: persona.useActivity ? 1 : 0,
      useData: persona.useData ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    });
    return persona;
  }

  async update(
    customerId: string,
    userId: string,
    id: string,
    partial: Partial<Persona>,
  ): Promise<Persona | null> {
    const existing = await this.findOne(customerId, userId, id);
    if (!existing) return null;

    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (partial.name !== undefined) set.name = partial.name;
    if (partial.role !== undefined) set.role = partial.role;
    if (partial.level !== undefined) set.level = partial.level;
    if (partial.department !== undefined) set.department = partial.department;
    if (partial.team !== undefined) set.team = partial.team ?? null;
    if (partial.focusAreas !== undefined)
      set.focusAreas = JSON.stringify(partial.focusAreas);
    if (partial.strengths !== undefined)
      set.strengths = JSON.stringify(partial.strengths);
    if (partial.weaknesses !== undefined)
      set.weaknesses = JSON.stringify(partial.weaknesses);
    if (partial.goals !== undefined) set.goals = partial.goals;
    if (partial.skills !== undefined)
      set.skills = JSON.stringify(partial.skills);
    if (partial.tools !== undefined) set.tools = JSON.stringify(partial.tools);
    if (partial.relationships !== undefined)
      set.relationships = JSON.stringify(partial.relationships);
    if (partial.communicationStyle !== undefined)
      set.communicationStyle = partial.communicationStyle
        ? JSON.stringify(partial.communicationStyle)
        : null;
    if (partial.domainKnowledge !== undefined)
      set.domainKnowledge = JSON.stringify(partial.domainKnowledge);
    if (partial.isDefault !== undefined)
      set.isDefault = partial.isDefault ? 1 : 0;
    if (partial.usePersona !== undefined)
      set.usePersona = partial.usePersona ? 1 : 0;
    if (partial.useActivity !== undefined)
      set.useActivity = partial.useActivity ? 1 : 0;
    if (partial.useData !== undefined) set.useData = partial.useData ? 1 : 0;

    await this.db
      .update(personas)
      .set(set)
      .where(
        and(
          eq(personas.id, uuidToBinary(id)),
          eq(personas.customerId, customerId),
          eq(personas.userId, uuidToBinary(userId)),
        ),
      );

    return this.findOne(customerId, userId, id);
  }

  async remove(
    customerId: string,
    userId: string,
    id: string,
  ): Promise<boolean> {
    const result = await this.db
      .delete(personas)
      .where(
        and(
          eq(personas.id, uuidToBinary(id)),
          eq(personas.customerId, customerId),
          eq(personas.userId, uuidToBinary(userId)),
        ),
      );
    return (
      ((result as unknown as { affectedRows?: number }).affectedRows ?? 0) > 0
    );
  }

  async setDefault(
    customerId: string,
    userId: string,
    id: string,
  ): Promise<Persona | null> {
    const existing = await this.findOne(customerId, userId, id);
    if (!existing) return null;

    // Clear existing defaults for this tenant
    await this.db
      .update(personas)
      .set({ isDefault: 0, updatedAt: new Date() })
      .where(
        and(
          eq(personas.customerId, customerId),
          eq(personas.userId, uuidToBinary(userId)),
          eq(personas.isDefault, 1),
        ),
      );

    // Set new default
    await this.db
      .update(personas)
      .set({ isDefault: 1, updatedAt: new Date() })
      .where(
        and(
          eq(personas.id, uuidToBinary(id)),
          eq(personas.customerId, customerId),
          eq(personas.userId, uuidToBinary(userId)),
        ),
      );

    return this.findOne(customerId, userId, id);
  }
}
