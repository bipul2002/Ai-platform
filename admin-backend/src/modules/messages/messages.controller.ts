import { Controller, Get, Param, Query, UseGuards, Request, ParseIntPipe, Res } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { Response } from 'express';

@ApiTags('Messages')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('messages')
export class MessagesController {
    constructor(private readonly messagesService: MessagesService) { }

    @Get(':messageId/results')
    @ApiOperation({ summary: 'Get paginated query results for a message' })
    @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
    @ApiQuery({ name: 'pageSize', required: false, type: Number, description: 'Page size (default: 10)' })
    async getMessageResults(
        @Param('messageId') messageId: string,
        @Query('page', new ParseIntPipe({ optional: true })) page: number = 1,
        @Query('pageSize', new ParseIntPipe({ optional: true })) pageSize: number = 10,
        @Request() req: any
    ) {
        return await this.messagesService.getQueryResults(
            messageId,
            req.user.sub,
            page,
            pageSize
        );
    }

    @Get(':messageId/export/excel')
    @ApiOperation({ summary: 'Download query results as Excel file' })
    async downloadExcel(
        @Param('messageId') messageId: string,
        @Request() req: any,
        @Res() res: Response
    ) {
        const buffer = await this.messagesService.generateExcel(messageId, req.user.sub);

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=query-results-${messageId.substring(0, 8)}.xlsx`);
        res.send(buffer);
    }
}
