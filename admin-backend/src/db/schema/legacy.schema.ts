import {
    pgTable,
    uuid,
    varchar,
    text,
    boolean,
    timestamp,
    bigint,
    integer,
    numeric,
    date,
} from 'drizzle-orm/pg-core';
import { dbTypeEnum, auditActionEnum } from './core.schema';

// Agent Overview Table (Legacy/Materialized View?)
export const agentOverview = pgTable("agent_overview", {
    id: uuid("id"),
    name: varchar("name", { length: 255 }),
    description: text("description"),
    isActive: boolean("is_active"),
    queryCount: bigint("query_count", { mode: "number" }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: 'string' }),
    dbType: dbTypeEnum("db_type"),
    host: varchar("host", { length: 255 }),
    databaseName: varchar("database_name", { length: 255 }),
    lastConnectionTestSuccess: boolean("last_connection_test_success"),
    tableCount: bigint("table_count", { mode: "number" }),
    columnCount: bigint("column_count", { mode: "number" }),
    embeddingCount: bigint("embedding_count", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }),
});

// Audit Log Summary Table
export const auditLogSummary = pgTable("audit_log_summary", {
    logDate: date("log_date"),
    agentId: uuid("agent_id"),
    action: auditActionEnum("action"),
    actionCount: bigint("action_count", { mode: "number" }),
    successCount: bigint("success_count", { mode: "number" }),
    failureCount: bigint("failure_count", { mode: "number" }),
    avgDurationMs: numeric("avg_duration_ms"),
});
