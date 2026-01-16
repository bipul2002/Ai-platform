import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CreateSensitivityRuleDto } from './create-sensitivity-rule.dto';

export class UpdateSensitivityRuleDto extends PartialType(CreateSensitivityRuleDto) {
  @ApiPropertyOptional({ description: 'Is rule active' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
