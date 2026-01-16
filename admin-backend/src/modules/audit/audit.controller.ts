import { Controller, Get, Query, UseGuards, ParseUUIDPipe, Req, Param, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('audit')
@Controller('audit')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class AuditController {
  constructor(private readonly auditService: AuditService) { }

  @Get('logs')
  @Roles('super_admin', 'admin')
  @ApiOperation({ summary: 'Get audit logs' })
  @ApiQuery({ name: 'agentId', required: false })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'organizationId', required: false })
  @ApiQuery({ name: 'action', required: false })
  @ApiQuery({ name: 'startDate', required: false, type: String })
  @ApiQuery({ name: 'endDate', required: false, type: String })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'List of audit logs' })
  async getAuditLogs(
    @Query('agentId') agentId?: string,
    @Query('userId') userId?: string,
    @Query('organizationId') organizationId?: string,
    @Query('action') action?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Req() req?: any,
  ) {
    // RBAC Enforcement: Admins can only see their organization's logs
    let effectiveOrgId = organizationId;
    if (req?.user?.role === 'admin') {
      effectiveOrgId = req.user.organizationId;
    }

    return this.auditService.getAuditLogs({
      agentId,
      userId,
      organizationId: effectiveOrgId,
      action,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 10,
    });
  }

  @Get('queries')
  @Roles('super_admin', 'admin', 'viewer')
  @ApiOperation({ summary: 'Get query history' })
  @ApiQuery({ name: 'agentId', required: false })
  @ApiQuery({ name: 'apiKeyId', required: false })
  @ApiQuery({ name: 'sessionId', required: false })
  @ApiQuery({ name: 'isSuccess', required: false, type: Boolean })
  @ApiQuery({ name: 'startDate', required: false, type: String })
  @ApiQuery({ name: 'endDate', required: false, type: String })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'List of query history' })
  async getQueryHistory(
    @Query('agentId') agentId?: string,
    @Query('apiKeyId') apiKeyId?: string,
    @Query('sessionId') sessionId?: string,
    @Query('isSuccess') isSuccess?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Req() req?: any,
  ) {
    // For viewers, filter by their own userId
    let effectiveUserId = undefined;
    if (req?.user?.role === 'viewer') {
      effectiveUserId = req.user.sub;
    }

    return this.auditService.getQueryHistory({
      agentId,
      apiKeyId,
      sessionId,
      userId: effectiveUserId,
      isSuccess: isSuccess !== undefined ? isSuccess === 'true' : undefined,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 10,
    });
  }

  @Get('queries/:id')
  @Roles('super_admin', 'admin', 'viewer')
  @ApiOperation({ summary: 'Get query details including LLM calls and pipeline execution' })
  @ApiResponse({ status: 200, description: 'Query details' })
  async getQueryDetails(@Param('id', ParseUUIDPipe) id: string, @Req() req?: any) {
    const queryDetails = await this.auditService.getQueryDetails(id);

    // Verify viewer can only see their own queries
    if (req?.user?.role === 'viewer' && queryDetails?.userId !== req.user.sub) {
      throw new ForbiddenException('Access denied');
    }

    return queryDetails;
  }
}
