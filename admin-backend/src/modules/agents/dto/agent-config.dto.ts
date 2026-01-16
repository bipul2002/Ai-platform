import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AgentConfigDto {
  @ApiProperty({ description: 'Agent ID' })
  agentId: string;

  @ApiProperty({ description: 'Agent name' })
  name: string;

  @ApiPropertyOptional({ description: 'Agent description' })
  description?: string;

  @ApiPropertyOptional({ description: 'Custom dictionary for domain semantics' })
  customDictionary?: Record<string, any>;

  @ApiPropertyOptional({ description: 'System prompt override' })
  systemPromptOverride?: string;

  @ApiProperty({ description: 'Maximum results limit' })
  maxResultsLimit: number;

  @ApiProperty({ description: 'Query timeout in seconds' })
  timeoutSeconds: number;

  @ApiPropertyOptional({ enum: ['postgresql', 'mysql'], description: 'Database type' })
  dbType?: string;
}
