import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  Patch
} from '@nestjs/common';
import { IsString, IsNotEmpty } from 'class-validator';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiProperty } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AgentApiKeysService } from './agent-api-keys.service';
import { UpdateAllowedOriginsDto } from './dto/update-allowed-origins.dto';

class CreateApiKeyDto {
  @ApiProperty({ description: 'The name of the API key' })
  @IsString()
  @IsNotEmpty()
  name: string;
}

@ApiTags('agent-api-keys')
@Controller('agents/:agentId/api-keys')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AgentApiKeysController {
  constructor(private readonly service: AgentApiKeysService) { }

  @Post()
  @ApiOperation({ summary: 'Create a new API key for an agent' })
  @ApiResponse({ status: 201, description: 'API key created successfully' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Agent not found' })
  async create(
    @Param('agentId') agentId: string,
    @Body() body: CreateApiKeyDto,
    @Request() req: any,
  ) {
    return this.service.create(
      agentId,
      body.name,
      req.user.sub,
      req.user.organizationId,
    );
  }

  @Get()
  @ApiOperation({ summary: 'List all API keys for an agent' })
  @ApiResponse({ status: 200, description: 'API keys retrieved successfully' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Agent not found' })
  async list(@Param('agentId') agentId: string, @Request() req: any) {
    return this.service.list(agentId, req.user.organizationId);
  }

  @Delete(':keyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke an API key' })
  @ApiResponse({ status: 204, description: 'API key revoked successfully' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'API key not found' })
  async revoke(
    @Param('keyId') keyId: string,
    @Request() req: any,
  ) {
    return this.service.revoke(keyId, req.user.organizationId);
  }

  @Get(':keyId/reveal')
  @ApiOperation({ summary: 'Reveal the plaintext API key' })
  @ApiResponse({ status: 200, description: 'API key revealed successfully' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'API key not found' })
  async reveal(
    @Param('keyId') keyId: string,
    @Request() req: any,
  ) {
    const key = await this.service.revealKey(keyId, req.user.organizationId);
    return { apiKey: key };
  }

  @Patch(':keyId/allowed-origins')
  updateAllowedOrigins(
    @Param('keyId') keyId: string,
    @Body() body: { origins: string[] },
  ) {
    return this.service.updateAllowedOrigins(keyId, body.origins)
  }
}
