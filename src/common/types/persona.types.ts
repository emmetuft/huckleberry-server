/** Values match the frontend Persona interface enum */
export enum RoleLevel {
  INTERN = 'Intern',
  JUNIOR = 'Junior',
  MID = 'Mid',
  SENIOR = 'Senior',
  LEAD = 'Lead',
  MANAGER = 'Manager',
  DIRECTOR = 'Director',
  VP = 'VP',
  C_LEVEL = 'C-Level',
  NONE = '',
}

export interface Persona {
  id: string;
  name: string;
  role: string;
  level: RoleLevel;
  department: string;
  team?: string;
  focusAreas: string[];
  strengths: string[];
  weaknesses: string[];
  goals: string;
  skills: PersonaSkill[];
  tools: string[];
  relationships: string[];
  communicationStyle: PersonaCommunicationStyle | null;
  domainKnowledge: string[];
  isDefault: boolean;
  usePersona: boolean;
  useActivity: boolean;
  useData: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PersonaSkill {
  name: string;
  type: 'hard' | 'soft';
}

export interface PersonaCommunicationStyle {
  preferredFormat: 'brief' | 'balanced' | 'detailed' | 'visual';
  tone: 'formal' | 'professional' | 'casual' | 'technical';
  decisionStyle: 'data-driven' | 'intuition' | 'consensus';
}
