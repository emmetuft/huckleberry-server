import { IsEnum, IsObject, IsOptional } from 'class-validator';

export enum ElicitationAction {
  ACCEPT = 'ACCEPT',
  DECLINE = 'DECLINE',
  CANCEL = 'CANCEL',
}

export class ElicitationItemDto {
  @IsEnum(ElicitationAction)
  action: ElicitationAction;

  @IsObject()
  @IsOptional()
  content?: Record<string, unknown>;
}

export class ElicitationResponseDto {
  @IsObject()
  items: Record<string, ElicitationItemDto>;
}
