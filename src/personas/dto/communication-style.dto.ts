import { IsEnum } from 'class-validator';

export class CommunicationStyleDto {
  @IsEnum(['brief', 'balanced', 'detailed', 'visual'])
  preferredFormat!: 'brief' | 'balanced' | 'detailed' | 'visual';

  @IsEnum(['formal', 'professional', 'casual', 'technical'])
  tone!: 'formal' | 'professional' | 'casual' | 'technical';

  @IsEnum(['data-driven', 'intuition', 'consensus'])
  decisionStyle!: 'data-driven' | 'intuition' | 'consensus';
}
