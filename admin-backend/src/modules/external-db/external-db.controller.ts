import { Controller, Post, Param, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ExternalDbService } from './external-db.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('external-db')
@Controller('agents/:agentId/external-db')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class ExternalDbController {
  constructor(private readonly externalDbService: ExternalDbService) {}

  @Post('test')
  @Roles('super_admin', 'admin')
  @ApiOperation({ summary: 'Test external database connection' })
  @ApiResponse({ status: 200, description: 'Connection test result' })
  async testConnection(@Param('agentId', ParseUUIDPipe) agentId: string) {
    return this.externalDbService.testConnection(agentId);
  }
}
