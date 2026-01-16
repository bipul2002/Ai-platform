import { IsString, IsOptional, IsBoolean, IsEnum } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateColumnDto {
  @ApiPropertyOptional({ description: 'Admin description for the column' })
  @IsOptional()
  @IsString()
  adminDescription?: string;

  @ApiPropertyOptional({ description: 'Semantic hints for AI understanding' })
  @IsOptional()
  @IsString()
  semanticHints?: string;

  @ApiPropertyOptional({ description: 'Custom prompt for this column' })
  @IsOptional()
  @IsString()
  customPrompt?: string;

  @ApiPropertyOptional({ description: 'Is column visible in schema' })
  @IsOptional()
  @IsBoolean()
  isVisible?: boolean;

  @ApiPropertyOptional({ description: 'Can column be queried' })
  @IsOptional()
  @IsBoolean()
  isQueryable?: boolean;

  @ApiPropertyOptional({ description: 'Is column sensitive' })
  @IsOptional()
  @IsBoolean()
  isSensitive?: boolean;

  @ApiPropertyOptional({ enum: ['low', 'medium', 'high', 'critical'], description: 'Sensitivity level override' })
  @IsOptional()
  @IsEnum(['low', 'medium', 'high', 'critical'])
  sensitivityOverride?: 'low' | 'medium' | 'high' | 'critical';

  @ApiPropertyOptional({ enum: ['full', 'partial', 'hash', 'redact', 'tokenize'], description: 'Masking strategy override' })
  @IsOptional()
  @IsEnum(['full', 'partial', 'hash', 'redact', 'tokenize'])
  maskingStrategyOverride?: 'full' | 'partial' | 'hash' | 'redact' | 'tokenize';
}
