import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class NodeIdentifierDto {
  @IsString()
  primaryLabel!: string;

  id!: unknown;
}

export class ShortestPathDto {
  fromNode!: NodeIdentifierDto;
  toNode!: NodeIdentifierDto;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  relationshipTypes?: string[];

  @IsNumber()
  @Min(1)
  @Max(20)
  @IsOptional()
  maxDepth?: number;
}
