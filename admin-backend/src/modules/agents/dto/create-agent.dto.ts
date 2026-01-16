import { IsString, IsOptional, IsArray, IsBoolean, IsNumber, IsObject, ValidateNested, IsEnum, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ExternalDbDto {
  @ApiProperty({ enum: ['postgresql', 'mysql'], description: 'Database type' })
  @IsEnum(['postgresql', 'mysql'])
  dbType: 'postgresql' | 'mysql';

  @ApiProperty({ example: 'localhost', description: 'Database host' })
  @IsString()
  host: string;

  @ApiProperty({ example: 5432, description: 'Database port' })
  @IsNumber()
  @Min(1)
  @Max(65535)
  port: number;

  @ApiProperty({ example: 'mydb', description: 'Database name' })
  @IsString()
  databaseName: string;

  @ApiProperty({ example: 'dbuser', description: 'Database username' })
  @IsString()
  username: string;

  @ApiProperty({ description: 'Database password' })
  @IsString()
  password: string;

  @ApiPropertyOptional({ default: false, description: 'Enable SSL connection' })
  @IsOptional()
  @IsBoolean()
  sslEnabled?: boolean;

  @ApiPropertyOptional({ default: 5, description: 'Connection pool size' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(50)
  connectionPoolSize?: number;

  @ApiPropertyOptional({ default: 5000, description: 'Connection timeout in milliseconds' })
  @IsOptional()
  @IsNumber()
  @Min(1000)
  @Max(60000)
  connectionTimeoutMs?: number;

  @ApiPropertyOptional({ type: [String], description: 'Schemas to include' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  schemaFilterInclude?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Schemas to exclude' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  schemaFilterExclude?: string[];
}

export class CreateAgentDto {
  @ApiProperty({ example: 'Sales Analytics Agent', description: 'Agent name' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'Agent description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ type: [String], example: ['sales', 'analytics'], description: 'Tags for categorization' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: 'Custom dictionary for domain semantics' })
  @IsOptional()
  @IsObject()
  customDictionary?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Custom system prompt override' })
  @IsOptional()
  @IsString()
  systemPromptOverride?: string;

  @ApiPropertyOptional({ default: 1000, description: 'Maximum results limit' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10000)
  maxResultsLimit?: number;

  @ApiPropertyOptional({ default: 30, description: 'Query timeout in seconds' })
  @IsOptional()
  @IsNumber()
  @Min(5)
  @Max(300)
  timeoutSeconds?: number;

  @ApiPropertyOptional({ enum: ['openai', 'anthropic', 'openrouter'], default: 'openai', description: 'LLM provider' })
  @IsOptional()
  @IsEnum(['openai', 'anthropic', 'openrouter'])
  llmProvider?: 'openai' | 'anthropic' | 'openrouter';

  @ApiPropertyOptional({ default: 'gpt-4-turbo-preview', description: 'LLM model name' })
  @IsOptional()
  @IsString()
  llmModel?: string;

  @ApiPropertyOptional({ default: 0, description: 'LLM temperature (0-2)', minimum: 0, maximum: 2 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  llmTemperature?: number;

  @ApiPropertyOptional({ type: [String], description: 'List of disabled global sensitivity rule IDs' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  disabledSensitivityRules?: string[];

  @ApiPropertyOptional({ type: ExternalDbDto, description: 'External database configuration' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ExternalDbDto)
  externalDb?: ExternalDbDto;
}
