import { IsString, IsOptional, IsEnum, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSensitivityRuleDto {
  @ApiProperty({ example: 'column_name', description: 'Pattern type' })
  @IsString()
  patternType: string;

  @ApiProperty({ example: 'password', description: 'Pattern value' })
  @IsString()
  patternValue: string;

  @ApiPropertyOptional({ description: 'Regex pattern for matching' })
  @IsOptional()
  @IsString()
  patternRegex?: string;

  @ApiProperty({ enum: ['low', 'medium', 'high', 'critical'], default: 'high' })
  @IsEnum(['low', 'medium', 'high', 'critical'])
  sensitivityLevel: 'low' | 'medium' | 'high' | 'critical';

  @ApiProperty({ enum: ['full', 'partial', 'hash', 'redact', 'tokenize'], default: 'full' })
  @IsEnum(['full', 'partial', 'hash', 'redact', 'tokenize'])
  maskingStrategy: 'full' | 'partial' | 'hash' | 'redact' | 'tokenize';

  @ApiPropertyOptional({ description: 'Description of the rule' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Column ID for agent-specific rules' })
  @IsOptional()
  @IsUUID()
  columnId?: string;
}
