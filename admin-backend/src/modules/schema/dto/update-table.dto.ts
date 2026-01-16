import { IsString, IsOptional, IsBoolean } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateTableDto {
  @ApiPropertyOptional({ description: 'Admin description for the table' })
  @IsOptional()
  @IsString()
  adminDescription?: string;

  @ApiPropertyOptional({ description: 'Semantic hints for AI understanding' })
  @IsOptional()
  @IsString()
  semanticHints?: string;

  @ApiPropertyOptional({ description: 'Custom prompt for this table' })
  @IsOptional()
  @IsString()
  customPrompt?: string;

  @ApiPropertyOptional({ description: 'Is table visible in schema' })
  @IsOptional()
  @IsBoolean()
  isVisible?: boolean;

  @ApiPropertyOptional({ description: 'Can table be queried' })
  @IsOptional()
  @IsBoolean()
  isQueryable?: boolean;
}
