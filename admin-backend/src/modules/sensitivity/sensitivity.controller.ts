import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SensitivityService } from './sensitivity.service';
import { CreateSensitivityRuleDto } from './dto/create-sensitivity-rule.dto';
import { UpdateSensitivityRuleDto } from './dto/update-sensitivity-rule.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('sensitivity')
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class SensitivityController {
  constructor(private readonly sensitivityService: SensitivityService) { }

  @Get('sensitivity/global')
  @ApiOperation({ summary: 'Get global sensitivity rules' })
  @ApiResponse({ status: 200, description: 'List of global rules' })
  async getGlobalRules() {
    return this.sensitivityService.getGlobalRules();
  }

  @Post('sensitivity/global')
  @Roles('super_admin')
  @ApiOperation({ summary: 'Create global sensitivity rule' })
  @ApiResponse({ status: 201, description: 'Rule created' })
  async createGlobalRule(@Body() dto: CreateSensitivityRuleDto, @Request() req: any) {
    return this.sensitivityService.createGlobalRule(dto, req.user.sub);
  }

  @Put('sensitivity/global/:id')
  @Roles('super_admin')
  @ApiOperation({ summary: 'Update global sensitivity rule' })
  @ApiResponse({ status: 200, description: 'Rule updated' })
  async updateGlobalRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSensitivityRuleDto,
    @Request() req: any,
  ) {
    return this.sensitivityService.updateGlobalRule(id, dto, req.user.sub);
  }

  @Delete('sensitivity/global/:id')
  @Roles('super_admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete global sensitivity rule' })
  @ApiResponse({ status: 204, description: 'Rule deleted' })
  async deleteGlobalRule(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.sensitivityService.deleteGlobalRule(id, req.user.sub);
  }

  @Get('agents/:agentId/sensitivity')
  @ApiOperation({ summary: 'Get agent sensitivity rules' })
  @ApiResponse({ status: 200, description: 'Agent rules with global rules' })
  async getAgentRules(@Param('agentId', ParseUUIDPipe) agentId: string) {
    return this.sensitivityService.getCombinedRules(agentId);
  }

  @Post('agents/:agentId/sensitivity')
  @Roles('super_admin', 'admin')
  @ApiOperation({ summary: 'Create agent sensitivity rule' })
  @ApiResponse({ status: 201, description: 'Rule created' })
  async createAgentRule(
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Body() dto: CreateSensitivityRuleDto,
    @Request() req: any,
  ) {
    return this.sensitivityService.createAgentRule(agentId, dto, req.user.sub);
  }

  @Put('agents/:agentId/sensitivity/:ruleId')
  @Roles('super_admin', 'admin')
  @ApiOperation({ summary: 'Update agent sensitivity rule' })
  @ApiResponse({ status: 200, description: 'Rule updated' })
  async updateAgentRule(
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @Body() dto: UpdateSensitivityRuleDto,
    @Request() req: any,
  ) {
    return this.sensitivityService.updateAgentRule(agentId, ruleId, dto, req.user.sub);
  }

  @Delete('agents/:agentId/sensitivity/:ruleId')
  @Roles('super_admin', 'admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete agent sensitivity rule' })
  @ApiResponse({ status: 204, description: 'Rule deleted' })
  async deleteAgentRule(
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @Request() req: any,
  ) {
    return this.sensitivityService.deleteAgentRule(agentId, ruleId, req.user.sub);
  }
}
