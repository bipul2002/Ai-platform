import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { EmbeddingsService } from './embeddings.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('embeddings')
@Controller('agents/:agentId/embeddings')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class EmbeddingsController {
  constructor(private readonly embeddingsService: EmbeddingsService) { }

  @Get()
  @ApiOperation({ summary: 'Get all embeddings for an agent' })
  @ApiResponse({ status: 200, description: 'List of embeddings' })
  async getEmbeddings(@Param('agentId', ParseUUIDPipe) agentId: string) {
    return this.embeddingsService.getEmbeddings(agentId);
  }

  @Post('generate')
  @Roles('super_admin', 'admin')
  @ApiOperation({ summary: 'Generate embeddings for schema' })
  @ApiResponse({ status: 200, description: 'Embeddings generated' })
  async generateEmbeddings(
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Request() req: any,
  ) {
    // Extract the JWT token from the Authorization header
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace('Bearer ', '');

    return this.embeddingsService.generateEmbeddings(agentId, req.user.sub, token);
  }

  @Get('search')
  @ApiOperation({ summary: 'Search similar schema elements' })
  @ApiQuery({ name: 'query', required: true, description: 'Search query' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Max results' })
  @ApiResponse({ status: 200, description: 'Similar schema elements' })
  async searchSimilar(
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Query('query') query: string,
    @Query('limit') limit?: string,
    @Request() req?: any,
  ) {
    // Extract the JWT token from the Authorization header
    const authHeader = req?.headers?.authorization;
    const token = authHeader?.replace('Bearer ', '');

    return this.embeddingsService.searchSimilar(
      agentId,
      query,
      limit ? parseInt(limit, 10) : 10,
      token,
    );
  }
}
