import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AgentsService } from './agents.service';
import { CreateAgentDto } from './dto/create-agent.dto';
import { UpdateAgentDto } from './dto/update-agent.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('agents')
@Controller('agents')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) { }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new agent' })
  @ApiResponse({ status: 201, description: 'The agent has been successfully created.' })
  async create(@Body() createAgentDto: CreateAgentDto, @Request() req: any) {
    return this.agentsService.create(createAgentDto, req.user.sub, req.user.organizationId);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all agents' })
  @ApiResponse({ status: 200, description: 'List of agents' })
  async findAll(@Query() query: any, @Request() req: any) {
    // Parse query parameters properly
    const parsedQuery = {
      ...query,
      isActive: query.isActive === 'true' ? true : query.isActive === 'false' ? false : undefined,
      page: query.page ? parseInt(query.page) : undefined,
      limit: query.limit ? parseInt(query.limit) : undefined,
    };

    // For Super Admins, allow filtering by organizationId
    // For regular Admins, enforce their own organizationId
    let effectiveOrgId = req.user.organizationId;
    if (req.user.role === 'super_admin' && query.organizationId) {
      effectiveOrgId = query.organizationId;
    }

    return this.agentsService.findAll(
      parsedQuery,
      effectiveOrgId,
      req.user.sub,        // userId
      req.user.role        // userRole
    );
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get agent details' })
  @ApiResponse({ status: 200, description: 'Agent details' })
  @ApiResponse({ status: 404, description: 'Agent not found' })
  async findOne(@Param('id') id: string, @Request() req: any) {
    return this.agentsService.findOne(id, req.user.organizationId);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update agent' })
  @ApiResponse({ status: 200, description: 'Agent updated successfully' })
  @ApiResponse({ status: 404, description: 'Agent not found' })
  async update(
    @Param('id') id: string,
    @Body() updateAgentDto: UpdateAgentDto,
    @Request() req: any,
  ) {
    return this.agentsService.update(id, updateAgentDto, req.user.sub, req.user.organizationId);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete agent' })
  async remove(@Param('id') id: string, @Request() req: any) {
    return this.agentsService.remove(id, req.user.sub, req.user.organizationId);
  }

  @Get(':id/config')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get agent configuration' })
  async getConfig(@Param('id') id: string, @Request() req: any) {
    // Ensure agent belongs to org
    await this.agentsService.findOne(id, req.user.organizationId);
    return this.agentsService.getConfig(id);
  }

  @Get(':id/connection-details')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get agent connection details (internal use)' })
  async getConnectionDetails(@Param('id') id: string) {
    return this.agentsService.getConnectionDetails(id);
  }

  @Get(':id/enriched-metadata')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get enriched schema metadata' })
  async getEnrichedMetadata(@Param('id') id: string, @Request() req: any) {
    // Ensure agent belongs to org
    await this.agentsService.findOne(id, req.user.organizationId);
    return this.agentsService.getEnrichedMetadata(id);
  }

  @Post(':id/update-last-used')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update agent last used timestamp' })
  async updateLastUsed(@Param('id') id: string, @Request() req: any) {
    // Ensure agent belongs to org
    await this.agentsService.findOne(id, req.user.organizationId);
    return this.agentsService.updateLastUsedAt(id);
  }
}
