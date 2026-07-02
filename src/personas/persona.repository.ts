import type { Persona } from '../common/types/persona.types.js';

export interface PersonaRepository {
  findAll(customerId: string, userId: string): Promise<Persona[]>;
  findOne(
    customerId: string,
    userId: string,
    id: string,
  ): Promise<Persona | null>;
  findDefault(customerId: string, userId: string): Promise<Persona | null>;
  create(
    customerId: string,
    userId: string,
    persona: Persona,
  ): Promise<Persona>;
  update(
    customerId: string,
    userId: string,
    id: string,
    partial: Partial<Persona>,
  ): Promise<Persona | null>;
  remove(customerId: string, userId: string, id: string): Promise<boolean>;
  setDefault(
    customerId: string,
    userId: string,
    id: string,
  ): Promise<Persona | null>;
}

export const PERSONA_REPOSITORY = Symbol('PersonaRepository');
