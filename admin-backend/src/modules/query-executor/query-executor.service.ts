import { Injectable, Logger } from '@nestjs/common';
import { ExternalDbService } from './external-db.service';

interface ParsedSql {
    cleanSql: string;
    hasLimit: boolean;
    limit: number;
    hasOffset: boolean;
    offset: number;
}

@Injectable()
export class QueryExecutorService {
    private readonly logger = new Logger(QueryExecutorService.name);

    constructor(private externalDbService: ExternalDbService) { }

    parseLimitOffset(sql: string): ParsedSql {
        // Regex to match LIMIT and OFFSET (case-insensitive)
        const limitOffsetRegex = /\s+LIMIT\s+(\d+)(\s+OFFSET\s+(\d+))?$/i;
        const match = sql.match(limitOffsetRegex);

        if (match) {
            return {
                cleanSql: sql.replace(limitOffsetRegex, '').trim(),
                hasLimit: true,
                limit: parseInt(match[1], 10),
                hasOffset: !!match[3],
                offset: match[3] ? parseInt(match[3], 10) : 0,
            };
        }

        return {
            cleanSql: sql.trim(),
            hasLimit: false,
            limit: Infinity,
            hasOffset: false,
            offset: 0,
        };
    }

    addPagination(sql: string, limit: number, offset: number): string {
        // Parse existing LIMIT/OFFSET from SQL
        const parsed = this.parseLimitOffset(sql);

        // If user requested specific limit (e.g., "show me 100 records")
        // respect it and don't exceed it
        const effectiveLimit = parsed.hasLimit
            ? Math.min(limit, parsed.limit)
            : limit;

        // Calculate effective offset
        const effectiveOffset = parsed.hasLimit
            ? Math.min(offset, parsed.limit) // Don't go beyond user's limit
            : offset;

        // Remove existing LIMIT/OFFSET
        const cleanSql = parsed.cleanSql;

        return `${cleanSql} LIMIT ${effectiveLimit} OFFSET ${effectiveOffset}`;
    }

    async getTotalCount(credentials: any, originalSql: string): Promise<number> {
        // Parse to check if user requested specific limit
        const parsed = this.parseLimitOffset(originalSql);

        // Always get actual count from database first (using clean SQL without limit/offset)
        const countSql = `SELECT COUNT(*) as total FROM (${parsed.cleanSql}) as subquery`;
        const result = await this.externalDbService.executeQuery(
            credentials,
            countSql,
        );
        const actualCount = parseInt(result[0]?.total || '0', 10);

        if (parsed.hasLimit) {
            // If user has a limit, total count should not exceed that limit
            // But if actual count is less than limit, return actual count
            return Math.min(actualCount, parsed.limit);
        }

        return actualCount;
    }
}
