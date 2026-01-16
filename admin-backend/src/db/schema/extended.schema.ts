import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  integer,
  jsonb,
  inet,
  index,
  uniqueIndex,
  customType,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { agents, agentColumns, adminUsers, organizations, agentApiKeys, sensitivityLevelEnum, maskingStrategyEnum, auditActionEnum, dbTypeEnum } from './core.schema';

// Custom vector type for pgvector
const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(1536)';
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    return value.slice(1, -1).split(',').map(Number);
  },
});

// Agent Schema Embeddings Table
export const agentSchemaEmbeddings = pgTable('agent_schema_embeddings', {
  id: uuid('id').defaultRandom().primaryKey(),
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  targetType: varchar('target_type', { length: 50 }).notNull(),
  targetId: uuid('target_id').notNull(),
  embeddingText: text('embedding_text').notNull(),
  embeddingVector: vector('embedding_vector'),
  embeddingModel: varchar('embedding_model', { length: 100 }).default('text-embedding-3-small'),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  agentIdIdx: index('idx_schema_embeddings_agent_id').on(table.agentId),
  targetIdx: index('idx_schema_embeddings_target').on(table.targetType, table.targetId),
  uniqueEmbedding: uniqueIndex('unique_agent_embedding').on(table.agentId, table.targetType, table.targetId),
}));

// Agent Additional Metadata Table
export const agentAdditionalMetadata = pgTable('agent_additional_metadata', {
  id: uuid('id').defaultRandom().primaryKey(),
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  metadataType: varchar('metadata_type', { length: 100 }).notNull(),
  targetType: varchar('target_type', { length: 50 }).notNull(),
  targetId: uuid('target_id').notNull(),
  key: varchar('key', { length: 255 }).notNull(),
  value: jsonb('value').notNull(),
  createdBy: uuid('created_by').references(() => adminUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  agentIdIdx: index('idx_agent_metadata_agent_id').on(table.agentId),
  targetIdx: index('idx_agent_metadata_target').on(table.targetType, table.targetId),
  uniqueMetadata: uniqueIndex('unique_agent_metadata').on(table.agentId, table.targetType, table.targetId, table.key),
}));

// Sensitive Field Registry - Global
export const sensitiveFieldRegistryGlobal = pgTable('sensitive_field_registry_global', {
  id: uuid('id').defaultRandom().primaryKey(),
  patternType: varchar('pattern_type', { length: 50 }).notNull(),
  patternValue: text('pattern_value').notNull(),
  patternRegex: text('pattern_regex'),
  sensitivityLevel: sensitivityLevelEnum('sensitivity_level').notNull().default('high'),
  maskingStrategy: maskingStrategyEnum('masking_strategy').notNull().default('full'),
  description: text('description'),
  isActive: boolean('is_active').default(true),
  createdBy: uuid('created_by').references(() => adminUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  patternIdx: index('idx_global_sensitivity_pattern').on(table.patternType, table.patternValue),
  activeIdx: index('idx_global_sensitivity_active').on(table.isActive),
}));

// Sensitive Field Registry - Agent-Specific
export const sensitiveFieldRegistryAgent = pgTable('sensitive_field_registry_agent', {
  id: uuid('id').defaultRandom().primaryKey(),
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  columnId: uuid('column_id').references(() => agentColumns.id, { onDelete: 'cascade' }),
  patternType: varchar('pattern_type', { length: 50 }),
  patternValue: text('pattern_value'),
  patternRegex: text('pattern_regex'),
  sensitivityLevel: sensitivityLevelEnum('sensitivity_level').notNull().default('high'),
  maskingStrategy: maskingStrategyEnum('masking_strategy').notNull().default('full'),
  description: text('description'),
  isActive: boolean('is_active').default(true),
  createdBy: uuid('created_by').references(() => adminUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  agentIdIdx: index('idx_agent_sensitivity_agent_id').on(table.agentId),
  columnIdIdx: index('idx_agent_sensitivity_column_id').on(table.columnId),
  activeIdx: index('idx_agent_sensitivity_active').on(table.isActive),
}));

// Forbidden Fields Table
export const forbiddenFields = pgTable('forbidden_fields', {
  id: uuid('id').defaultRandom().primaryKey(),
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'cascade' }),
  scope: varchar('scope', { length: 20 }).notNull().default('agent'),
  tablePattern: text('table_pattern'),
  columnPattern: text('column_pattern'),
  reason: text('reason'),
  isActive: boolean('is_active').default(true),
  createdBy: uuid('created_by').references(() => adminUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  agentIdIdx: index('idx_forbidden_fields_agent_id').on(table.agentId),
  scopeIdx: index('idx_forbidden_fields_scope').on(table.scope),
}));

// Audit Logs Table
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
  userId: uuid('user_id').references(() => adminUsers.id, { onDelete: 'set null' }),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
  sessionId: varchar('session_id', { length: 255 }),
  action: auditActionEnum('action').notNull(),
  resourceType: varchar('resource_type', { length: 100 }),
  resourceId: uuid('resource_id'),
  details: jsonb('details').default({}),
  ipAddress: inet('ip_address'),
  userAgent: text('user_agent'),
  durationMs: integer('duration_ms'),
  isSuccess: boolean('is_success').default(true),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  agentIdIdx: index('idx_audit_logs_agent_id').on(table.agentId),
  userIdIdx: index('idx_audit_logs_user_id').on(table.userId),
  organizationIdIdx: index('idx_audit_logs_organization_id').on(table.organizationId),
  actionIdx: index('idx_audit_logs_action').on(table.action),
  createdAtIdx: index('idx_audit_logs_created_at').on(table.createdAt),
  resourceIdx: index('idx_audit_logs_resource').on(table.resourceType, table.resourceId),
}));

// Query History Table
export const queryHistory = pgTable('query_history', {
  id: uuid('id').defaultRandom().primaryKey(),
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
  sessionId: varchar('session_id', { length: 255 }),
  userMessage: text('user_message').notNull(),
  canonicalQuery: jsonb('canonical_query'),
  generatedSql: text('generated_sql'),
  sqlDialect: dbTypeEnum('sql_dialect'),
  executionTimeMs: integer('execution_time_ms'),
  rowCount: integer('row_count'),
  isSuccess: boolean('is_success').default(true),
  errorMessage: text('error_message'),
  validationErrors: jsonb('validation_errors'),
  sanitizationApplied: jsonb('sanitization_applied'),
  threadId: varchar('thread_id', { length: 255 }),
  isRefinement: boolean('is_refinement').default(false),
  iterationCount: integer('iteration_count').default(1),
  apiKeyId: uuid('api_key_id').references(() => agentApiKeys.id, { onDelete: 'set null' }),
  apiKeyName: varchar('api_key_name', { length: 255 }),
  userId: uuid('user_id').references(() => adminUsers.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  agentIdIdx: index('idx_query_history_agent_id').on(table.agentId),
  organizationIdIdx: index('idx_query_history_organization_id').on(table.organizationId),
  userIdIdx: index('idx_query_history_user_id').on(table.userId),
  sessionIdIdx: index('idx_query_history_session_id').on(table.sessionId),
  createdAtIdx: index('idx_query_history_created_at').on(table.createdAt),
  successIdx: index('idx_query_history_success').on(table.isSuccess),
  threadIdIdx: index('idx_query_history_thread_id').on(table.threadId),
  isRefinementIdx: index('idx_query_history_is_refinement').on(table.isRefinement),
  apiKeyIdIdx: index('idx_query_history_api_key_id').on(table.apiKeyId),
}));

// Query Pipeline Execution Table - Tracks node execution flow
export const queryPipelineExecution = pgTable('query_pipeline_execution', {
  id: uuid('id').defaultRandom().primaryKey(),
  queryHistoryId: uuid('query_history_id').notNull().references(() => queryHistory.id, { onDelete: 'cascade' }),
  nodeName: varchar('node_name', { length: 100 }).notNull(),
  executionOrder: integer('execution_order').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  durationMs: integer('duration_ms'),
  nodeState: jsonb('node_state'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  queryHistoryIdIdx: index('idx_pipeline_exec_query_id').on(table.queryHistoryId),
  nodeNameIdx: index('idx_pipeline_exec_node_name').on(table.nodeName),
  startedAtIdx: index('idx_pipeline_exec_started_at').on(table.startedAt),
}));

// Query LLM Calls Table - Tracks all LLM API calls with complete configuration
export const queryLlmCalls = pgTable('query_llm_calls', {
  id: uuid('id').defaultRandom().primaryKey(),
  queryHistoryId: uuid('query_history_id').notNull().references(() => queryHistory.id, { onDelete: 'cascade' }),
  nodeName: varchar('node_name', { length: 100 }).notNull(),
  llmProvider: varchar('llm_provider', { length: 50 }).notNull(),
  llmModel: varchar('llm_model', { length: 100 }).notNull(),
  systemPrompt: text('system_prompt'),
  prompt: text('prompt').notNull(),
  response: text('response'),
  llmConfig: jsonb('llm_config'),
  tokenUsage: jsonb('token_usage'),
  durationMs: integer('duration_ms'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  queryHistoryIdIdx: index('idx_llm_calls_query_id').on(table.queryHistoryId),
  nodeNameIdx: index('idx_llm_calls_node_name').on(table.nodeName),
  providerIdx: index('idx_llm_calls_provider').on(table.llmProvider),
  modelIdx: index('idx_llm_calls_model').on(table.llmModel),
  createdAtIdx: index('idx_llm_calls_created_at').on(table.createdAt),
}));

// Refresh Tokens Table
export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => adminUsers.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 255 }).notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  isRevoked: boolean('is_revoked').default(false),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  userIdIdx: index('idx_refresh_tokens_user_id').on(table.userId),
  tokenHashIdx: index('idx_refresh_tokens_hash').on(table.tokenHash),
  expiresIdx: index('idx_refresh_tokens_expires').on(table.expiresAt),
}));

// Chat Sessions Table
export const chatSessions = pgTable('chat_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  sessionToken: varchar('session_token', { length: 255 }).notNull().unique(),
  context: jsonb('context').default({}),
  messageCount: integer('message_count').default(0),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  agentIdIdx: index('idx_chat_sessions_agent_id').on(table.agentId),
  tokenIdx: index('idx_chat_sessions_token').on(table.sessionToken),
}));

// Relations
export const agentSchemaEmbeddingsRelations = relations(agentSchemaEmbeddings, ({ one }) => ({
  agent: one(agents, {
    fields: [agentSchemaEmbeddings.agentId],
    references: [agents.id],
  }),
}));

export const sensitiveFieldRegistryGlobalRelations = relations(sensitiveFieldRegistryGlobal, ({ one }) => ({
  createdBy: one(adminUsers, {
    fields: [sensitiveFieldRegistryGlobal.createdBy],
    references: [adminUsers.id],
  }),
}));

export const sensitiveFieldRegistryAgentRelations = relations(sensitiveFieldRegistryAgent, ({ one }) => ({
  agent: one(agents, {
    fields: [sensitiveFieldRegistryAgent.agentId],
    references: [agents.id],
  }),
  column: one(agentColumns, {
    fields: [sensitiveFieldRegistryAgent.columnId],
    references: [agentColumns.id],
  }),
  createdBy: one(adminUsers, {
    fields: [sensitiveFieldRegistryAgent.createdBy],
    references: [adminUsers.id],
  }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  agent: one(agents, {
    fields: [auditLogs.agentId],
    references: [agents.id],
  }),
  user: one(adminUsers, {
    fields: [auditLogs.userId],
    references: [adminUsers.id],
  }),
}));

export const queryHistoryRelations = relations(queryHistory, ({ one, many }) => ({
  agent: one(agents, {
    fields: [queryHistory.agentId],
    references: [agents.id],
  }),
  apiKey: one(agentApiKeys, {
    fields: [queryHistory.apiKeyId],
    references: [agentApiKeys.id],
  }),
  user: one(adminUsers, {
    fields: [queryHistory.userId],
    references: [adminUsers.id],
  }),
  pipelineExecutions: many(queryPipelineExecution),
  llmCalls: many(queryLlmCalls),
}));

export const queryPipelineExecutionRelations = relations(queryPipelineExecution, ({ one }) => ({
  queryHistory: one(queryHistory, {
    fields: [queryPipelineExecution.queryHistoryId],
    references: [queryHistory.id],
  }),
}));

export const queryLlmCallsRelations = relations(queryLlmCalls, ({ one }) => ({
  queryHistory: one(queryHistory, {
    fields: [queryLlmCalls.queryHistoryId],
    references: [queryHistory.id],
  }),
}));

export const chatSessionsRelations = relations(chatSessions, ({ one }) => ({
  agent: one(agents, {
    fields: [chatSessions.agentId],
    references: [agents.id],
  }),
}));
