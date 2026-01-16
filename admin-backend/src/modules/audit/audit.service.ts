import { Injectable, Inject } from '@nestjs/common';
import { eq, desc, and, gte, lte, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { auditLogs, queryHistory, queryLlmCalls, queryPipelineExecution, adminUsers } from '../../db/schema';

interface AuditLogEntry {
  agentId?: string;
  userId?: string;
  organizationId?: string | null;
  sessionId?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  details?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  durationMs?: number;
  isSuccess?: boolean;
  errorMessage?: string;
}

interface QueryHistoryEntry {
  agentId: string;
  userId?: string;
  sessionId?: string;
  userMessage: string;
  canonicalQuery?: any;
  generatedSql?: string;
  sqlDialect?: 'postgresql' | 'mysql';
  executionTimeMs?: number;
  rowCount?: number;
  isSuccess?: boolean;
  errorMessage?: string;
  validationErrors?: any;
  sanitizationApplied?: any;
  apiKeyId?: string;
  apiKeyName?: string;
}

@Injectable()
export class AuditService {
  constructor(@Inject(DRIZZLE) private db: DrizzleDB) { }

  async log(entry: AuditLogEntry): Promise<void> {
    try {
      await this.db.insert(auditLogs).values({
        agentId: entry.agentId,
        userId: entry.userId,
        organizationId: entry.organizationId,
        sessionId: entry.sessionId,
        action: entry.action as any,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        details: entry.details || {},
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        durationMs: entry.durationMs,
        isSuccess: entry.isSuccess ?? true,
        errorMessage: entry.errorMessage,
      });
    } catch (error) {
      console.error('Failed to write audit log:', error);
    }
  }

  async logQuery(entry: QueryHistoryEntry): Promise<void> {
    try {
      await this.db.insert(queryHistory).values({
        agentId: entry.agentId,
        userId: entry.userId,
        sessionId: entry.sessionId,
        userMessage: entry.userMessage,
        canonicalQuery: entry.canonicalQuery,
        generatedSql: entry.generatedSql,
        sqlDialect: entry.sqlDialect,
        executionTimeMs: entry.executionTimeMs,
        rowCount: entry.rowCount,
        isSuccess: entry.isSuccess ?? true,
        errorMessage: entry.errorMessage,
        validationErrors: entry.validationErrors,
        sanitizationApplied: entry.sanitizationApplied,
        apiKeyId: entry.apiKeyId,
        apiKeyName: entry.apiKeyName,
      });
    } catch (error) {
      console.error('Failed to write query history:', error);
    }
  }

  async getAuditLogs(query: {
    agentId?: string;
    userId?: string;
    organizationId?: string;
    action?: string;
    startDate?: Date;
    endDate?: Date;
    page?: number;
    limit?: number;
  }): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const page = query.page || 1;
    const limit = query.limit || 50;
    const offset = (page - 1) * limit;

    const conditions = [];

    if (query.agentId) {
      conditions.push(eq(auditLogs.agentId, query.agentId));
    }
    if (query.userId) {
      conditions.push(eq(auditLogs.userId, query.userId));
    }
    if (query.organizationId !== undefined) {
      // Support filtering by organizationId, including null for global logs
      if (query.organizationId === null || query.organizationId === 'null') {
        conditions.push(sql`${auditLogs.organizationId} IS NULL`);
      } else {
        conditions.push(eq(auditLogs.organizationId, query.organizationId));
      }
    }
    if (query.action) {
      conditions.push(eq(auditLogs.action, query.action as any));
    }
    if (query.startDate) {
      conditions.push(gte(auditLogs.createdAt, query.startDate));
    }
    if (query.endDate) {
      conditions.push(lte(auditLogs.createdAt, query.endDate));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [logs, countResult] = await Promise.all([
      this.db
        .select({
          log: auditLogs,
          userName: sql<string>`concat(${adminUsers.firstName}, ' ', ${adminUsers.lastName})`,
          userEmail: adminUsers.email,
        })
        .from(auditLogs)
        .leftJoin(adminUsers, eq(auditLogs.userId, adminUsers.id))
        .where(whereClause)
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(auditLogs)
        .where(whereClause),
    ]);

    return {
      data: logs.map(l => ({
        ...l.log,
        userName: l.userName,
        userEmail: l.userEmail,
      })),
      total: Number(countResult[0]?.count || 0),
      page,
      limit,
    };
  }

  async getQueryHistory(query: {
    agentId?: string;
    userId?: string;
    apiKeyId?: string;
    sessionId?: string;
    isSuccess?: boolean;
    organizationId?: string;
    startDate?: Date;
    endDate?: Date;
    page?: number;
    limit?: number;
  }): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const page = query.page || 1;
    const limit = query.limit || 50;
    const offset = (page - 1) * limit;

    const conditions = [];

    if (query.agentId) {
      conditions.push(eq(queryHistory.agentId, query.agentId));
    }
    if (query.userId) {
      conditions.push(eq(queryHistory.userId, query.userId));
    }
    if (query.apiKeyId) {
      conditions.push(eq(queryHistory.apiKeyId, query.apiKeyId));
    }
    if (query.sessionId) {
      conditions.push(eq(queryHistory.sessionId, query.sessionId));
    }
    if (query.isSuccess !== undefined) {
      conditions.push(eq(queryHistory.isSuccess, query.isSuccess));
    }
    if (query.organizationId) {
      conditions.push(eq(queryHistory.organizationId, query.organizationId));
    }
    if (query.startDate) {
      conditions.push(gte(queryHistory.createdAt, query.startDate));
    }
    if (query.endDate) {
      conditions.push(lte(queryHistory.createdAt, query.endDate));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [history, countResult] = await Promise.all([
      this.db
        .select({
          history: queryHistory,
          userName: sql<string>`concat(${adminUsers.firstName}, ' ', ${adminUsers.lastName})`,
          userEmail: adminUsers.email,
        })
        .from(queryHistory)
        .leftJoin(adminUsers, eq(queryHistory.userId, adminUsers.id))
        .where(whereClause)
        .orderBy(desc(queryHistory.createdAt))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(queryHistory)
        .where(whereClause),
    ]);

    return {
      data: history.map(h => ({
        ...h.history,
        userName: h.userName,
        userEmail: h.userEmail,
      })),
      total: Number(countResult[0]?.count || 0),
      page,
      limit,
    };
  }

  async getQueryDetails(id: string): Promise<any> {
    const history = await this.db.query.queryHistory.findFirst({
      where: eq(queryHistory.id, id),
      with: {
        user: true,
        apiKey: true,
        llmCalls: {
          orderBy: (calls, { desc }) => [desc(calls.createdAt)],
        },
        pipelineExecutions: {
          orderBy: (execs, { desc }) => [desc(execs.executionOrder)],
        },
      },
    });

    if (!history) {
      return null;
    }

    return history;
  }
}
