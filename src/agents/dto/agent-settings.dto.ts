import { IsObject, IsOptional } from 'class-validator';

export class AgentSettingsDto {
  @IsObject()
  @IsOptional()
  properties?: Record<string, any>;
}
