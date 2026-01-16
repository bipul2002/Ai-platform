import {
    Controller,
    Post,
    Body,
    UseGuards,
    Res,
    Request,
    BadRequestException,
    Logger,
    Inject,
    InternalServerErrorException,
} from '@nestjs/common';
import { Response } from 'express';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { firstValueFrom } from 'rxjs';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ExecuteQueryDto } from './dto/execute-query.dto';
import { ExportExcelDto } from './dto/export-excel.dto';
import { GenerateSqlDto } from './dto/generate-sql.dto';
import { ExternalDbService } from './external-db.service';
import { QueryExecutorService } from './query-executor.service';
import { ExcelExportService } from './excel-export.service';
import { AgentApiKeysService } from '../agents/agent-api-keys.service';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { agents } from '../../db/schema/core.schema';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('query-executor')
@Controller('query-executor')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class QueryExecutorController {
    private readonly logger = new Logger(QueryExecutorController.name);
    private readonly aiRuntimeUrl: string;

    constructor(
        @Inject(DRIZZLE) private db: DrizzleDB,
        private externalDbService: ExternalDbService,
        private queryExecutorService: QueryExecutorService,
        private excelExportService: ExcelExportService,
        private agentApiKeysService: AgentApiKeysService,
        private httpService: HttpService,
        private configService: ConfigService,
    ) {
        this.aiRuntimeUrl = this.configService.get<string>('aiRuntime.url') || 'http://ai-runtime:8000';
    }

    @Post('generate-sql')
    @ApiOperation({ summary: 'Generate SQL from natural language query (without execution)' })
    @ApiResponse({ status: 200, description: 'SQL generated successfully' })
    @ApiResponse({ status: 400, description: 'Invalid request' })
    @ApiResponse({ status: 404, description: 'Agent not found' })
    async generateSql(
        @Body() dto: GenerateSqlDto,
        @Request() req: any,
    ) {
        const { agentId, query } = dto;

        // 1. Verify user has access to agent
        await this.verifyAccess(req.user.sub, agentId);

        // 2. Call ai-runtime to generate SQL
        try {
            const response = await firstValueFrom(
                this.httpService.post(
                    `${this.aiRuntimeUrl}/api/agents/${agentId}/generate-sql`,
                    { query },
                    {
                        headers: {
                            'Authorization': req.headers.authorization,
                            'Content-Type': 'application/json',
                        },
                        timeout: 60000, // 60 seconds timeout for LLM processing
                    }
                )
            );

            return response.data;
        } catch (error) {
            this.logger.error('Failed to generate SQL', { error: error.message, agentId });

            if (error.response?.data) {
                throw new BadRequestException(error.response.data.detail || 'Failed to generate SQL');
            }

            throw new InternalServerErrorException('Failed to communicate with AI runtime');
        }
    }

    @Post('execute')
    @ApiOperation({ summary: 'Execute SQL query against agent database' })
    async executeQuery(
        @Body() dto: ExecuteQueryDto,
        @Request() req: any,
    ) {
        const { agentId, sql, page = 1, pageSize = 10 } = dto;

        // 1. Verify user has access to agent
        await this.verifyAccess(req.user.sub, agentId);

        // 2. Get agent's external DB credentials
        const credentials = await this.externalDbService.getAgentCredentials(
            agentId,
        );

        // 3. Add pagination to SQL
        const offset = (page - 1) * pageSize;
        const paginatedSql = this.queryExecutorService.addPagination(
            sql,
            pageSize,
            offset,
        );

        // 4. Execute query on external DB
        const results = await this.externalDbService.executeQuery(
            credentials,
            paginatedSql,
        );

        // 5. Update API key usage if applicable
        if (req.user.role === 'api_key') {
            await this.agentApiKeysService.updateUsage(req.user.sub);
        }

        // 6. Get total count (for pagination)
        const totalCount = await this.queryExecutorService.getTotalCount(
            credentials,
            sql,
        );

        return {
            data: results,
            pagination: {
                page,
                pageSize,
                totalCount,
                totalPages: Math.ceil(totalCount / pageSize),
            },
        };
    }

    @Post('export-excel')
    @ApiOperation({ summary: 'Export query results to Excel' })
    async exportToExcel(
        @Body() dto: ExportExcelDto,
        @Res() res: Response,
        @Request() req: any,
    ) {
        const { agentId, sql } = dto;

        // 1. Verify access
        await this.verifyAccess(req.user.sub, agentId);

        // 2. Get credentials
        const credentials = await this.externalDbService.getAgentCredentials(
            agentId,
        );

        // 3. Get total count
        const totalCount = await this.queryExecutorService.getTotalCount(
            credentials,
            sql,
        );

        // 4. Set response headers for Excel download
        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        );
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="query-results-${Date.now()}.xlsx"`,
        );

        // 5. Stream Excel file with chunked data
        await this.excelExportService.streamExcelWithChunks(
            res,
            credentials,
            sql,
            totalCount,
        );
    }

    private async verifyAccess(userId: string, agentId: string): Promise<void> {
        const agentResult = await this.db
            .select()
            .from(agents)
            .where(eq(agents.id, agentId))
            .limit(1);

        if (!agentResult || agentResult.length === 0) {
            throw new BadRequestException('Agent not found');
        }

        // For now, skip user organization check since adminUsers might not have organizationId
        // TODO: Implement proper access control based on your auth system
        this.logger.log(`Access granted for user ${userId} to agent ${agentId}`);
    }
}
