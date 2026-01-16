import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { messages } from '../../db/schema/core.schema';
import { eq } from 'drizzle-orm';
import * as ExcelJS from 'exceljs';

@Injectable()
export class MessagesService {
    constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) { }

    async getQueryResults(
        messageId: string,
        userId: string,
        page: number,
        pageSize: number
    ) {
        // 1. Fetch message with ownership verification
        const message = await this.db.query.messages.findFirst({
            where: eq(messages.id, messageId),
            with: {
                conversation: {
                    columns: { userId: true }
                }
            }
        });

        if (!message) {
            throw new NotFoundException('Message not found');
        }

        if (!message.conversation || message.conversation.userId !== userId) {
            throw new NotFoundException('Message not found');
        }

        // 2. Extract results from metadata
        const metadata = message.metadata as any;
        const queryResults = metadata?.query_results || [];
        const totalRows = queryResults.length;

        // 3. Paginate
        const startIndex = (page - 1) * pageSize;
        const endIndex = startIndex + pageSize;
        const paginatedData = queryResults.slice(startIndex, endIndex);

        return {
            data: paginatedData,
            pagination: {
                page,
                pageSize,
                totalRows,
                totalPages: Math.ceil(totalRows / pageSize),
                hasMore: endIndex < totalRows
            },
            metadata: {
                sql: metadata?.sql,
                row_count: metadata?.row_count
            }
        };
    }

    async generateExcel(messageId: string, userId: string): Promise<any> {
        // 1. Fetch message with ownership verification
        const message = await this.db.query.messages.findFirst({
            where: eq(messages.id, messageId),
            with: {
                conversation: {
                    columns: { userId: true }
                }
            }
        });

        if (!message) {
            throw new NotFoundException('Message not found');
        }

        if (!message.conversation || message.conversation.userId !== userId) {
            throw new NotFoundException('Message not found');
        }

        // 2. Extract results from metadata
        const metadata = message.metadata as any;
        const queryResults = metadata?.query_results || [];

        if (queryResults.length === 0) {
            throw new BadRequestException('No results to export');
        }

        // 3. Create Excel workbook
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Query Results');

        // 4. Add headers
        const columns = Object.keys(queryResults[0]);
        worksheet.columns = columns.map(col => ({
            header: col,
            key: col,
            width: 15
        }));

        // 5. Style header row
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE0E0E0' }
        };

        // 6. Add data rows
        queryResults.forEach((row: any) => {
            worksheet.addRow(row);
        });

        // 7. Auto-fit columns
        worksheet.columns.forEach(column => {
            let maxLength = 0;
            column.eachCell?.({ includeEmpty: true }, (cell) => {
                const length = cell.value ? cell.value.toString().length : 10;
                if (length > maxLength) maxLength = length;
            });
            column.width = Math.min(maxLength + 2, 50);
        });

        // 8. Return buffer
        return await workbook.xlsx.writeBuffer();
    }
}
