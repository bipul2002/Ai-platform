import { PartialType, OmitType } from '@nestjs/swagger';
import { IsBoolean, IsOptional, ValidateNested } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { CreateAgentDto, ExternalDbDto } from './create-agent.dto';

export class UpdateExternalDbDto extends PartialType(ExternalDbDto) { }

export class UpdateAgentDto extends PartialType(OmitType(CreateAgentDto, ['externalDb'] as const)) {
  @ApiPropertyOptional({ description: 'Is agent active' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ type: UpdateExternalDbDto, description: 'External database configuration' })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateExternalDbDto)
  externalDb?: UpdateExternalDbDto;
}
