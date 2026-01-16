import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  integer,
  bigint,
  jsonb,
  pgEnum,
  decimal,
  inet,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Enums
export const dbTypeEnum = pgEnum('db_type', ['postgresql', 'mysql']);
export const userRoleEnum = pgEnum('user_role', ['super_admin', 'admin', 'viewer']);
export const auditActionEnum = pgEnum('audit_action', [
  'agent_created', 'agent_updated', 'agent_deleted',
  'schema_ingested', 'schema_updated', 'schema_refreshed',
  'embedding_generated', 'embedding_updated',
  'sensitivity_rule_created', 'sensitivity_rule_updated', 'sensitivity_rule_deleted',
  'query_executed', 'query_failed',
  'user_login', 'user_logout',
  'config_updated', 'metadata_updated'
]);
export const sensitivityLevelEnum = pgEnum('sensitivity_level', ['low', 'medium', 'high', 'critical']);
export const maskingStrategyEnum = pgEnum('masking_strategy', ['full', 'partial', 'hash', 'redact', 'tokenize']);
export const llmProviderEnum = pgEnum('llm_provider', ['openai', 'anthropic', 'openrouter']);

// Org Table
export const organizations = pgTable('organizations', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  slugIdx: uniqueIndex('idx_organizations_slug').on(table.slug),
}));

// Magic Links Table
export const magicLinks = pgTable('magic_links', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => adminUsers.id, { onDelete: 'cascade' }),
  token: varchar('token', { length: 255 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  used: boolean('used').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  tokenIdx: index('idx_magic_links_token').on(table.token),
  userIdIdx: index('idx_magic_links_user_id').on(table.userId),
}));

// Admin Users Table
export const adminUsers = pgTable('admin_users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }), // Nullable for passwordless
  refreshTokenHash: varchar('refresh_token_hash', { length: 255 }), // For secure session management
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }), // Org association
  role: userRoleEnum('role').notNull().default('viewer'),
  firstName: varchar('first_name', { length: 100 }),
  lastName: varchar('last_name', { length: 100 }),
  isActive: boolean('is_active').default(true),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
  failedLoginAttempts: integer('failed_login_attempts').default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  emailIdx: uniqueIndex('idx_admin_users_email').on(table.email),
  roleIdx: index('idx_admin_users_role').on(table.role),
  orgIdx: index('idx_admin_users_org_id').on(table.organizationId),
}));

// User Agent Access Table - Controls which agents users can access
export const userAgentAccess = pgTable('user_agent_access', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => adminUsers.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  grantedBy: uuid('granted_by').references(() => adminUsers.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  userIdIdx: index('idx_user_agent_access_user_id').on(table.userId),
  agentIdIdx: index('idx_user_agent_access_agent_id').on(table.agentId),
  uniqueAccess: uniqueIndex('unique_user_agent_access').on(table.userId, table.agentId),
}));

// Agents Table
export const agents = pgTable('agents', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }), // Scoped to Org
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  tags: text('tags').array().default([]),
  isActive: boolean('is_active').default(true),
  createdBy: uuid('created_by').references(() => adminUsers.id),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  queryCount: bigint('query_count', { mode: 'number' }).default(0),
  customDictionary: jsonb('custom_dictionary').default({}),
  systemPromptOverride: text('system_prompt_override'),
  maxResultsLimit: integer('max_results_limit').default(1000),
  timeoutSeconds: integer('timeout_seconds').default(30),
  llmProvider: llmProviderEnum('llm_provider').default('openai'),
  llmModel: varchar('llm_model', { length: 100 }).default('gpt-4-turbo-preview'),
  llmTemperature: decimal('llm_temperature', { precision: 3, scale: 2 }).default('0.00'),
  disabledSensitivityRules: text('disabled_sensitivity_rules').array().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  nameIdx: index('idx_agents_name').on(table.name),
  isActiveIdx: index('idx_agents_is_active').on(table.isActive),
  createdByIdx: index('idx_agents_created_by').on(table.createdBy),
  orgIdx: index('idx_agents_org_id').on(table.organizationId),
}));

// Agent API Keys Table
export const agentApiKeys = pgTable('agent_api_keys', {
  id: uuid('id').defaultRandom().primaryKey(),
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  encryptedKey: text('encrypted_key').notNull().unique(),
  createdBy: uuid('created_by').references(() => adminUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  isActive: boolean('is_active').default(true).notNull(),
  requestCount: integer('request_count').default(0).notNull(),
  allowedOrigins: text('allowed_origins').array(),
}, (table) => ({
  agentIdIdx: index('idx_agent_api_keys_agent_id').on(table.agentId),
  encryptedKeyIdx: uniqueIndex('idx_agent_api_keys_encrypted_key').on(table.encryptedKey),
  createdByIdx: index('idx_agent_api_keys_created_by').on(table.createdBy),
}));

// Agent External DB Credentials Table
export const agentExternalDbCredentials = pgTable('agent_external_db_credentials', {
  id: uuid('id').defaultRandom().primaryKey(),
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }).unique(),
  dbType: dbTypeEnum('db_type').notNull(),
  host: varchar('host', { length: 255 }).notNull(),
  port: integer('port').notNull(),
  databaseName: varchar('database_name', { length: 255 }).notNull(),
  username: varchar('username', { length: 255 }).notNull(),
  encryptedPassword: text('encrypted_password').notNull(),
  sslEnabled: boolean('ssl_enabled').default(false),
  sslCaCert: text('ssl_ca_cert'),
  sslClientCert: text('ssl_client_cert'),
  sslClientKey: text('ssl_client_key'),
  connectionPoolSize: integer('connection_pool_size').default(5),
  connectionTimeoutMs: integer('connection_timeout_ms').default(5000),
  schemaFilterInclude: text('schema_filter_include').array().default([]),
  schemaFilterExclude: text('schema_filter_exclude').array().default([]),
  lastConnectionTestAt: timestamp('last_connection_test_at', { withTimezone: true }),
  lastConnectionTestSuccess: boolean('last_connection_test_success'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  agentIdIdx: index('idx_agent_ext_db_agent_id').on(table.agentId),
}));

// Agent Tables Table
export const agentTables = pgTable('agent_tables', {
  id: uuid('id').defaultRandom().primaryKey(),
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  tableName: varchar('table_name', { length: 255 }).notNull(),
  schemaName: varchar('schema_name', { length: 255 }).default('public'),
  originalComment: text('original_comment'),
  adminDescription: text('admin_description'),
  semanticHints: text('semantic_hints'),
  customPrompt: text('custom_prompt'),
  isVisible: boolean('is_visible').default(true),
  isQueryable: boolean('is_queryable').default(true),
  rowCountEstimate: bigint('row_count_estimate', { mode: 'number' }),
  lastAnalyzedAt: timestamp('last_analyzed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  agentIdIdx: index('idx_agent_tables_agent_id').on(table.agentId),
  tableNameIdx: index('idx_agent_tables_name').on(table.tableName),
  uniqueTable: uniqueIndex('unique_agent_table').on(table.agentId, table.schemaName, table.tableName),
}));

// Agent Columns Table
export const agentColumns = pgTable('agent_columns', {
  id: uuid('id').defaultRandom().primaryKey(),
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  tableId: uuid('table_id').notNull().references(() => agentTables.id, { onDelete: 'cascade' }),
  columnName: varchar('column_name', { length: 255 }).notNull(),
  dataType: varchar('data_type', { length: 100 }).notNull(),
  isNullable: boolean('is_nullable').default(true),
  isPrimaryKey: boolean('is_primary_key').default(false),
  isForeignKey: boolean('is_foreign_key').default(false),
  isUnique: boolean('is_unique').default(false),
  isIndexed: boolean('is_indexed').default(false),
  defaultValue: text('default_value'),
  originalComment: text('original_comment'),
  adminDescription: text('admin_description'),
  semanticHints: text('semantic_hints'),
  customPrompt: text('custom_prompt'),
  sampleValues: text('sample_values').array(),
  valueDistribution: jsonb('value_distribution'),
  isVisible: boolean('is_visible').default(true),
  isQueryable: boolean('is_queryable').default(true),
  isSensitive: boolean('is_sensitive').default(false),
  sensitivityOverride: sensitivityLevelEnum('sensitivity_override'),
  maskingStrategyOverride: maskingStrategyEnum('masking_strategy_override'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  agentIdIdx: index('idx_agent_columns_agent_id').on(table.agentId),
  tableIdIdx: index('idx_agent_columns_table_id').on(table.tableId),
  columnNameIdx: index('idx_agent_columns_name').on(table.columnName),
  sensitiveIdx: index('idx_agent_columns_sensitive').on(table.isSensitive),
  uniqueColumn: uniqueIndex('unique_table_column').on(table.tableId, table.columnName),
}));

// Agent Relationships Table
export const agentRelationships = pgTable('agent_relationships', {
  id: uuid('id').defaultRandom().primaryKey(),
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  sourceTableId: uuid('source_table_id').notNull().references(() => agentTables.id, { onDelete: 'cascade' }),
  sourceColumnId: uuid('source_column_id').notNull().references(() => agentColumns.id, { onDelete: 'cascade' }),
  targetTableId: uuid('target_table_id').notNull().references(() => agentTables.id, { onDelete: 'cascade' }),
  targetColumnId: uuid('target_column_id').notNull().references(() => agentColumns.id, { onDelete: 'cascade' }),
  relationshipType: varchar('relationship_type', { length: 50 }).default('foreign_key'),
  isInferred: boolean('is_inferred').default(false),
  confidenceScore: decimal('confidence_score', { precision: 3, scale: 2 }),
  originalConstraintName: varchar('original_constraint_name', { length: 255 }),
  adminDescription: text('admin_description'),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  agentIdIdx: index('idx_agent_relationships_agent_id').on(table.agentId),
  sourceTableIdx: index('idx_agent_relationships_source_table').on(table.sourceTableId),
  targetTableIdx: index('idx_agent_relationships_target_table').on(table.targetTableId),
}));

// Relations
export const adminUsersRelations = relations(adminUsers, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [adminUsers.organizationId],
    references: [organizations.id],
  }),
  createdAgents: many(agents),
  createdApiKeys: many(agentApiKeys),
  magicLinks: many(magicLinks),
  agentAccess: many(userAgentAccess),
}));

export const magicLinksRelations = relations(magicLinks, ({ one }) => ({
  user: one(adminUsers, {
    fields: [magicLinks.userId],
    references: [adminUsers.id],
  }),
}));

export const userAgentAccessRelations = relations(userAgentAccess, ({ one }) => ({
  user: one(adminUsers, {
    fields: [userAgentAccess.userId],
    references: [adminUsers.id],
  }),
  agent: one(agents, {
    fields: [userAgentAccess.agentId],
    references: [agents.id],
  }),
  grantor: one(adminUsers, {
    fields: [userAgentAccess.grantedBy],
    references: [adminUsers.id],
  }),
}));

export const organizationsRelations = relations(organizations, ({ many }) => ({
  users: many(adminUsers),
  agents: many(agents),
}));

export const agentsRelations = relations(agents, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [agents.organizationId],
    references: [organizations.id],
  }),
  createdBy: one(adminUsers, {
    fields: [agents.createdBy],
    references: [adminUsers.id],
  }),
  credentials: one(agentExternalDbCredentials),
  apiKeys: many(agentApiKeys),
  tables: many(agentTables),
  columns: many(agentColumns),
  relationships: many(agentRelationships),
}));

export const agentApiKeysRelations = relations(agentApiKeys, ({ one }) => ({
  agent: one(agents, {
    fields: [agentApiKeys.agentId],
    references: [agents.id],
  }),
  creator: one(adminUsers, {
    fields: [agentApiKeys.createdBy],
    references: [adminUsers.id],
  }),
}));

export const agentExternalDbCredentialsRelations = relations(agentExternalDbCredentials, ({ one }) => ({
  agent: one(agents, {
    fields: [agentExternalDbCredentials.agentId],
    references: [agents.id],
  }),
}));

export const agentTablesRelations = relations(agentTables, ({ one, many }) => ({
  agent: one(agents, {
    fields: [agentTables.agentId],
    references: [agents.id],
  }),
  columns: many(agentColumns),
}));

export const agentColumnsRelations = relations(agentColumns, ({ one }) => ({
  agent: one(agents, {
    fields: [agentColumns.agentId],
    references: [agents.id],
  }),
  table: one(agentTables, {
    fields: [agentColumns.tableId],
    references: [agentTables.id],
  }),
}));

// Conversation Tables

export const conversationRoleEnum = pgEnum('conversation_role', ['user', 'assistant', 'system']);

export const conversations = pgTable('conversations', {
  id: uuid('id').defaultRandom().primaryKey(),
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => adminUsers.id, { onDelete: 'set null' }),
  apiKeyId: uuid('api_key_id').references(() => agentApiKeys.id, { onDelete: 'set null' }),
  title: varchar('title', { length: 255 }).default('New Conversation'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  agentIdIdx: index('idx_conversations_agent_id').on(table.agentId),
  userIdIdx: index('idx_conversations_user_id').on(table.userId),
  apiKeyIdIdx: index('idx_conversations_api_key_id').on(table.apiKeyId),
}));

export const messages = pgTable('messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  role: conversationRoleEnum('role').notNull(),
  content: text('content').notNull(),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  threadId: varchar('thread_id', { length: 255 }),
}, (table) => ({
  conversationIdIdx: index('idx_messages_conversation_id').on(table.conversationId),
  createdAtIdx: index('idx_messages_created_at').on(table.createdAt),
  threadIdIdx: index('idx_messages_thread_id').on(table.threadId),
}));

export const queryThreads = pgTable('query_threads', {
  id: uuid('id').defaultRandom().primaryKey(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  threadId: varchar('thread_id', { length: 255 }).notNull().unique(),
  initialQuery: text('initial_query').notNull(),
  currentSql: text('current_sql'),
  metadata: jsonb('metadata').default({}),
  iterationCount: integer('iteration_count').default(1),
  status: varchar('status', { length: 50 }).default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  conversationIdIdx: index('idx_query_threads_conversation').on(table.conversationId),
  threadIdIdx: index('idx_query_threads_thread_id').on(table.threadId),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  agent: one(agents, {
    fields: [conversations.agentId],
    references: [agents.id],
  }),
  user: one(adminUsers, {
    fields: [conversations.userId],
    references: [adminUsers.id],
  }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  queryThread: one(queryThreads, {
    fields: [messages.threadId],
    references: [queryThreads.threadId],
  }),
}));

export const queryThreadsRelations = relations(queryThreads, ({ one, many }) => ({
  conversation: one(conversations, {
    fields: [queryThreads.conversationId],
    references: [conversations.id],
  }),
  messages: many(messages),
}));
