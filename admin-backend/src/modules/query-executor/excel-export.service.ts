import { Injectable, Logger } from '@nestjs/common';
import { Response } from 'express';
import * as ExcelJS from 'exceljs';
import { ExternalDbService } from './external-db.service';
import { QueryExecutorService } from './query-executor.service';

@Injectable()
export class ExcelExportService {
    private readonly logger = new Logger(ExcelExportService.name);
    private readonly CHUNK_SIZE = 100; // Fetch 100 records at a time

    constructor(
        private externalDbService: ExternalDbService,
        private queryExecutorService: QueryExecutorService,
    ) { }

    async streamExcelWithChunks(
        res: Response,
        credentials: any,
        sql: string,
        totalCount: number,
    ): Promise<void> {
        // Parse to check if user requested specific limit
        const parsed = this.queryExecutorService.parseLimitOffset(sql);

        // Respect user's limit if present
        const maxRecords = parsed.hasLimit ? parsed.limit : totalCount;

        this.logger.log(
            `Starting Excel export: ${maxRecords} records, user limit: ${parsed.hasLimit ? parsed.limit : 'none'}`,
        );

        const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
            stream: res,
            useStyles: true,
            useSharedStrings: true,
        });

        const worksheet = workbook.addWorksheet('Results');

        let isFirstChunk = true;
        let offset = 0;
        let totalExported = 0;

        try {
            // Fetch and write data in chunks (respecting user's limit)
            while (offset < maxRecords) {
                // Calculate chunk size (don't exceed user's limit)
                const chunkSize = Math.min(this.CHUNK_SIZE, maxRecords - offset);

                const chunkSql = `${parsed.cleanSql} LIMIT ${chunkSize} OFFSET ${offset}`;
                const chunk = await this.externalDbService.executeQuery(
                    credentials,
                    chunkSql,
                );

                if (chunk.length === 0) break;

                // Add header row (only for first chunk)
                if (isFirstChunk && chunk.length > 0) {
                    const headers = Object.keys(chunk[0]);
                    worksheet.addRow(headers);

                    // Style header row
                    worksheet.getRow(1).font = { bold: true };
                    worksheet.getRow(1).fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFE0E0E0' },
                    };

                    isFirstChunk = false;
                }

                // Add data rows
                for (const row of chunk) {
                    const values = Object.values(row);
                    worksheet.addRow(values);
                    totalExported++;
                }

                // Commit rows to free memory
                await worksheet.commit();

                offset += chunkSize;

                // Log progress
                this.logger.log(
                    `Excel export progress: ${offset}/${maxRecords} (${Math.round((offset / maxRecords) * 100)}%)`,
                );
            }

            // Auto-size columns
            worksheet.columns.forEach((column) => {
                column.width = 15;
            });

            // Finalize workbook
            await workbook.commit();

            this.logger.log(
                `Excel export completed: ${totalExported} records exported`,
            );
        } catch (error) {
            this.logger.error('Excel export failed', error.stack);
            throw error;
        }
    }
}
