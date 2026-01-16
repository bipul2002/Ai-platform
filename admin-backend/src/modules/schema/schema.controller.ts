import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  UseGuards,
  Request,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SchemaService } from './schema.service';
import { UpdateTableDto } from './dto/update-table.dto';
import { UpdateColumnDto } from './dto/update-column.dto';
import { ImportSchemaDto } from './dto/import-schema.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('schema')
@Controller('agents/:agentId/schema')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class SchemaController {
  constructor(private readonly schemaService: SchemaService) { }

  @Get()
  @ApiOperation({ summary: 'Get schema for an agent' })
  @ApiResponse({ status: 200, description: 'Schema with tables, columns, and relationships' })
  async getSchema(@Param('agentId', ParseUUIDPipe) agentId: string) {
    return this.schemaService.getSchema(agentId);
  }

  @Post('refresh')
  @Roles('super_admin', 'admin')
  @ApiOperation({ summary: 'Refresh schema from external database' })
  @ApiResponse({ status: 200, description: 'Schema refreshed successfully' })
  async refreshSchema(
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Request() req: any,
  ) {
    return this.schemaService.refreshSchema(agentId, req.user.sub);
  }

  @Post('import')
  @Roles('super_admin', 'admin')
  @ApiOperation({ summary: 'Import schema from JSON (without database connection)' })
  @ApiResponse({ status: 201, description: 'Schema imported successfully' })
  @ApiResponse({ status: 400, description: 'Invalid schema format' })
  @ApiResponse({ status: 404, description: 'Agent not found' })
  async importSchema(
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Body() importDto: ImportSchemaDto,
    @Request() req: any,
  ) {
    return this.schemaService.importSchema(agentId, importDto, req.user.sub);
  }

  @Get('tables/:tableId')
  @ApiOperation({ summary: 'Get table details' })
  @ApiResponse({ status: 200, description: 'Table with columns' })
  async getTable(
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Param('tableId', ParseUUIDPipe) tableId: string,
  ) {
    return this.schemaService.getTable(agentId, tableId);
  }

  @Put('tables/:tableId')
  @Roles('super_admin', 'admin')
  @ApiOperation({ summary: 'Update table metadata' })
  @ApiResponse({ status: 200, description: 'Table updated' })
  async updateTable(
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Param('tableId', ParseUUIDPipe) tableId: string,
    @Body() updateDto: UpdateTableDto,
    @Request() req: any,
  ) {
    return this.schemaService.updateTable(agentId, tableId, updateDto, req.user.sub);
  }

  @Put('columns/:columnId')
  @Roles('super_admin', 'admin')
  @ApiOperation({ summary: 'Update column metadata' })
  @ApiResponse({ status: 200, description: 'Column updated' })
  async updateColumn(
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Param('columnId', ParseUUIDPipe) columnId: string,
    @Body() updateDto: UpdateColumnDto,
    @Request() req: any,
  ) {
    return this.schemaService.updateColumn(agentId, columnId, updateDto, req.user.sub);
  }

  @Get('relationships')
  @ApiOperation({ summary: 'Get all relationships for an agent' })
  @ApiResponse({ status: 200, description: 'List of relationships' })
  async getRelationships(@Param('agentId', ParseUUIDPipe) agentId: string) {
    return this.schemaService.getRelationships(agentId);
  }
}
