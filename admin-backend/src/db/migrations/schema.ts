import { pgTable, index, foreignKey, pgEnum, uuid, varchar, text, boolean, timestamp, bigint, jsonb, integer, numeric, unique, uniqueIndex, date, inet, customType } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

const vector1536 = customType<{ data: number[] }>({
	dataType() {
		return 'vector(1536)';
	},
});

export const dbType = pgEnum("db_type", ['mysql', 'postgresql'])
export const userRole = pgEnum("user_role", ['viewer', 'admin', 'super_admin'])
export const auditAction = pgEnum("audit_action", ['metadata_updated', 'config_updated', 'user_logout', 'user_login', 'query_failed', 'query_executed', 'sensitivity_rule_deleted', 'sensitivity_rule_updated', 'sensitivity_rule_created', 'embedding_updated', 'embedding_generated', 'schema_updated', 'schema_ingested', 'agent_deleted', 'agent_updated', 'agent_created'])
export const sensitivityLevel = pgEnum("sensitivity_level", ['critical', 'high', 'medium', 'low'])
export const maskingStrategy = pgEnum("masking_strategy", ['tokenize', 'redact', 'hash', 'partial', 'full'])
export const llmProvider = pgEnum("llm_provider", ['anthropic', 'openai'])
export const conversationRole = pgEnum("conversation_role", ['system', 'assistant', 'user'])


export const agents = pgTable("agents", {
	id: uuid("id").default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	name: varchar("name", { length: 255 }).notNull(),
	description: text("description"),
	tags: text("tags").default('{}').array(),
	isActive: boolean("is_active").default(true),
	createdBy: uuid("created_by").references(() => adminUsers.id).references(() => adminUsers.id),
	lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: 'string' }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	queryCount: bigint("query_count", { mode: "number" }).default(0),
	customDictionary: jsonb("custom_dictionary").default({}),
	systemPromptOverride: text("system_prompt_override"),
	maxResultsLimit: integer("max_results_limit").default(1000),
	timeoutSeconds: integer("timeout_seconds").default(30),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	llmProvider: llmProvider("llm_provider").default('openai'),
	llmModel: varchar("llm_model", { length: 100 }).default('gpt-4-turbo-preview'),
	llmTemperature: numeric("llm_temperature", { precision: 3, scale: 2 }).default('0.00'),
},
	(table) => {
		return {
			idxAgentsName: index("idx_agents_name").on(table.name),
			idxAgentsIsActive: index("idx_agents_is_active").on(table.isActive),
			idxAgentsTags: index("idx_agents_tags").on(table.tags),
			idxAgentsCreatedBy: index("idx_agents_created_by").on(table.createdBy),
		}
	});

export const adminUsers = pgTable("admin_users", {
	id: uuid("id").default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	email: varchar("email", { length: 255 }).notNull(),
	passwordHash: varchar("password_hash", { length: 255 }).notNull(),
	role: userRole("role").default('viewer').notNull(),
	firstName: varchar("first_name", { length: 100 }),
	lastName: varchar("last_name", { length: 100 }),
	isActive: boolean("is_active").default(true),
	lastLoginAt: timestamp("last_login_at", { withTimezone: true, mode: 'string' }),
	passwordChangedAt: timestamp("password_changed_at", { withTimezone: true, mode: 'string' }),
	failedLoginAttempts: integer("failed_login_attempts").default(0),
	lockedUntil: timestamp("locked_until", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
},
	(table) => {
		return {
			idxAdminUsersEmail: index("idx_admin_users_email").on(table.email),
			idxAdminUsersRole: index("idx_admin_users_role").on(table.role),
			adminUsersEmailKey: unique("admin_users_email_key").on(table.email),
		}
	});

export const chatSessions = pgTable("chat_sessions", {
	id: uuid("id").default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }).references(() => agents.id, { onDelete: "cascade" }),
	sessionToken: varchar("session_token", { length: 255 }).notNull(),
	context: jsonb("context").default({}),
	messageCount: integer("message_count").default(0),
	lastMessageAt: timestamp("last_message_at", { withTimezone: true, mode: 'string' }),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
},
	(table) => {
		return {
			idxChatSessionsAgentId: index("idx_chat_sessions_agent_id").on(table.agentId),
			idxChatSessionsToken: index("idx_chat_sessions_token").on(table.sessionToken),
			chatSessionsSessionTokenKey: unique("chat_sessions_session_token_key").on(table.sessionToken),
		}
	});

export const agentExternalDbCredentials = pgTable("agent_external_db_credentials", {
	id: uuid("id").default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }).references(() => agents.id, { onDelete: "cascade" }),
	dbType: dbType("db_type").notNull(),
	host: varchar("host", { length: 255 }).notNull(),
	port: integer("port").notNull(),
	databaseName: varchar("database_name", { length: 255 }).notNull(),
	username: varchar("username", { length: 255 }).notNull(),
	encryptedPassword: text("encrypted_password").notNull(),
	sslEnabled: boolean("ssl_enabled").default(false),
	sslCaCert: text("ssl_ca_cert"),
	sslClientCert: text("ssl_client_cert"),
	sslClientKey: text("ssl_client_key"),
	connectionPoolSize: integer("connection_pool_size").default(5),
	connectionTimeoutMs: integer("connection_timeout_ms").default(5000),
	schemaFilterInclude: text("schema_filter_include").default('{}').array(),
	schemaFilterExclude: text("schema_filter_exclude").default('{}').array(),
	lastConnectionTestAt: timestamp("last_connection_test_at", { withTimezone: true, mode: 'string' }),
	lastConnectionTestSuccess: boolean("last_connection_test_success"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
},
	(table) => {
		return {
			idxAgentExtDbAgentId: index("idx_agent_ext_db_agent_id").on(table.agentId),
			agentExternalDbCredentialsAgentIdKey: unique("agent_external_db_credentials_agent_id_key").on(table.agentId),
		}
	});

export const agentColumns = pgTable("agent_columns", {
	id: uuid("id").default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }).references(() => agents.id, { onDelete: "cascade" }),
	tableId: uuid("table_id").notNull().references(() => agentTables.id, { onDelete: "cascade" }).references(() => agentTables.id, { onDelete: "cascade" }),
	columnName: varchar("column_name", { length: 255 }).notNull(),
	dataType: varchar("data_type", { length: 100 }).notNull(),
	isNullable: boolean("is_nullable").default(true),
	isPrimaryKey: boolean("is_primary_key").default(false),
	isForeignKey: boolean("is_foreign_key").default(false),
	isUnique: boolean("is_unique").default(false),
	isIndexed: boolean("is_indexed").default(false),
	defaultValue: text("default_value"),
	originalComment: text("original_comment"),
	adminDescription: text("admin_description"),
	semanticHints: text("semantic_hints"),
	customPrompt: text("custom_prompt"),
	sampleValues: text("sample_values").array(),
	valueDistribution: jsonb("value_distribution"),
	isVisible: boolean("is_visible").default(true),
	isQueryable: boolean("is_queryable").default(true),
	isSensitive: boolean("is_sensitive").default(false),
	sensitivityOverride: sensitivityLevel("sensitivity_override"),
	maskingStrategyOverride: maskingStrategy("masking_strategy_override"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
},
	(table) => {
		return {
			idxAgentColumnsAgentId: index("idx_agent_columns_agent_id").on(table.agentId),
			idxAgentColumnsTableId: index("idx_agent_columns_table_id").on(table.tableId),
			idxAgentColumnsName: index("idx_agent_columns_name").on(table.columnName),
			idxAgentColumnsSensitive: index("idx_agent_columns_sensitive").on(table.isSensitive),
			uniqueTableColumn: uniqueIndex("unique_table_column").on(table.tableId, table.columnName),
			agentColumnsTableIdColumnNameKey: unique("agent_columns_table_id_column_name_key").on(table.tableId, table.columnName),
		}
	});

export const agentTables = pgTable("agent_tables", {
	id: uuid("id").default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }).references(() => agents.id, { onDelete: "cascade" }),
	tableName: varchar("table_name", { length: 255 }).notNull(),
	schemaName: varchar("schema_name", { length: 255 }).default('public'),
	originalComment: text("original_comment"),
	adminDescription: text("admin_description"),
	semanticHints: text("semantic_hints"),
	customPrompt: text("custom_prompt"),
	isVisible: boolean("is_visible").default(true),
	isQueryable: boolean("is_queryable").default(true),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	rowCountEstimate: bigint("row_count_estimate", { mode: "number" }),
	lastAnalyzedAt: timestamp("last_analyzed_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
},
	(table) => {
		return {
			idxAgentTablesAgentId: index("idx_agent_tables_agent_id").on(table.agentId),
			idxAgentTablesName: index("idx_agent_tables_name").on(table.tableName),
			uniqueAgentTable: uniqueIndex("unique_agent_table").on(table.agentId, table.tableName, table.schemaName),
			agentTablesAgentIdSchemaNameTableNameKey: unique("agent_tables_agent_id_schema_name_table_name_key").on(table.agentId, table.tableName, table.schemaName),
		}
	});

export const agentRelationships = pgTable("agent_relationships", {
	id: uuid("id").default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }).references(() => agents.id, { onDelete: "cascade" }),
	sourceTableId: uuid("source_table_id").notNull().references(() => agentTables.id, { onDelete: "cascade" }).references(() => agentTables.id, { onDelete: "cascade" }),
	sourceColumnId: uuid("source_column_id").notNull().references(() => agentColumns.id, { onDelete: "cascade" }).references(() => agentColumns.id, { onDelete: "cascade" }),
	targetTableId: uuid("target_table_id").notNull().references(() => agentTables.id, { onDelete: "cascade" }).references(() => agentTables.id, { onDelete: "cascade" }),
	targetColumnId: uuid("target_column_id").notNull().references(() => agentColumns.id, { onDelete: "cascade" }).references(() => agentColumns.id, { onDelete: "cascade" }),
	relationshipType: varchar("relationship_type", { length: 50 }).default('foreign_key'),
	isInferred: boolean("is_inferred").default(false),
	confidenceScore: numeric("confidence_score", { precision: 3, scale: 2 }),
	originalConstraintName: varchar("original_constraint_name", { length: 255 }),
	adminDescription: text("admin_description"),
	isActive: boolean("is_active").default(true),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
},
	(table) => {
		return {
			idxAgentRelationshipsAgentId: index("idx_agent_relationships_agent_id").on(table.agentId),
			idxAgentRelationshipsSourceTable: index("idx_agent_relationships_source_table").on(table.sourceTableId),
			idxAgentRelationshipsTargetTable: index("idx_agent_relationships_target_table").on(table.targetTableId),
		}
	});

export const agentAdditionalMetadata = pgTable("agent_additional_metadata", {
	id: uuid("id").default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }).references(() => agents.id, { onDelete: "cascade" }),
	metadataType: varchar("metadata_type", { length: 100 }).notNull(),
	targetType: varchar("target_type", { length: 50 }).notNull(),
	targetId: uuid("target_id").notNull(),
	key: varchar("key", { length: 255 }).notNull(),
	value: jsonb("value").notNull(),
	createdBy: uuid("created_by").references(() => adminUsers.id).references(() => adminUsers.id),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
},
	(table) => {
		return {
			idxAgentMetadataAgentId: index("idx_agent_metadata_agent_id").on(table.agentId),
			idxAgentMetadataTarget: index("idx_agent_metadata_target").on(table.targetType, table.targetId),
			uniqueAgentMetadata: uniqueIndex("unique_agent_metadata").on(table.agentId, table.targetType, table.targetId, table.key),
			agentAdditionalMetadataAgentIdTargetTypeTargetIdKeKey: unique("agent_additional_metadata_agent_id_target_type_target_id_ke_key").on(table.agentId, table.targetType, table.targetId, table.key),
		}
	});

export const agentSchemaEmbeddings = pgTable("agent_schema_embeddings", {
	id: uuid("id").default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }).references(() => agents.id, { onDelete: "cascade" }),
	targetType: varchar("target_type", { length: 50 }).notNull(),
	targetId: uuid("target_id").notNull(),
	embeddingText: text("embedding_text").notNull(),
	// TODO: failed to parse database type 'vector(1536)'
	embeddingVector: vector1536("embedding_vector"),
	embeddingModel: varchar("embedding_model", { length: 100 }).default('text-embedding-3-small'),
	metadata: jsonb("metadata").default({}),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
},
	(table) => {
		return {
			idxSchemaEmbeddingsAgentId: index("idx_schema_embeddings_agent_id").on(table.agentId),
			idxSchemaEmbeddingsTarget: index("idx_schema_embeddings_target").on(table.targetType, table.targetId),
			idxSchemaEmbeddingsVector: index("idx_schema_embeddings_vector").on(table.embeddingVector),
			uniqueAgentEmbedding: uniqueIndex("unique_agent_embedding").on(table.agentId, table.targetType, table.targetId),
			agentSchemaEmbeddingsAgentIdTargetTypeTargetIdKey: unique("agent_schema_embeddings_agent_id_target_type_target_id_key").on(table.agentId, table.targetType, table.targetId),
		}
	});

export const sensitiveFieldRegistryGlobal = pgTable("sensitive_field_registry_global", {
	id: uuid("id").default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	patternType: varchar("pattern_type", { length: 50 }).notNull(),
	patternValue: text("pattern_value").notNull(),
	patternRegex: text("pattern_regex"),
	sensitivityLevel: sensitivityLevel("sensitivity_level").default('high').notNull(),
	maskingStrategy: maskingStrategy("masking_strategy").default('full').notNull(),
	description: text("description"),
	isActive: boolean("is_active").default(true),
	createdBy: uuid("created_by").references(() => adminUsers.id).references(() => adminUsers.id),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
},
	(table) => {
		return {
			idxGlobalSensitivityPattern: index("idx_global_sensitivity_pattern").on(table.patternType, table.patternValue),
			idxGlobalSensitivityActive: index("idx_global_sensitivity_active").on(table.isActive),
		}
	});

export const agentOverview = pgTable("agent_overview", {
	id: uuid("id"),
	name: varchar("name", { length: 255 }),
	description: text("description"),
	isActive: boolean("is_active"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	queryCount: bigint("query_count", { mode: "number" }),
	lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: 'string' }),
	dbType: dbType("db_type"),
	host: varchar("host", { length: 255 }),
	databaseName: varchar("database_name", { length: 255 }),
	lastConnectionTestSuccess: boolean("last_connection_test_success"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	tableCount: bigint("table_count", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	columnCount: bigint("column_count", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	embeddingCount: bigint("embedding_count", { mode: "number" }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }),
});

export const auditLogSummary = pgTable("audit_log_summary", {
	logDate: date("log_date"),
	agentId: uuid("agent_id"),
	action: auditAction("action"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	actionCount: bigint("action_count", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	successCount: bigint("success_count", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	failureCount: bigint("failure_count", { mode: "number" }),
	avgDurationMs: numeric("avg_duration_ms"),
});

export const sensitiveFieldRegistryAgent = pgTable("sensitive_field_registry_agent", {
	id: uuid("id").default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }).references(() => agents.id, { onDelete: "cascade" }),
	columnId: uuid("column_id").references(() => agentColumns.id, { onDelete: "cascade" }).references(() => agentColumns.id, { onDelete: "cascade" }),
	patternType: varchar("pattern_type", { length: 50 }),
	patternValue: text("pattern_value"),
	patternRegex: text("pattern_regex"),
	sensitivityLevel: sensitivityLevel("sensitivity_level").default('high').notNull(),
	maskingStrategy: maskingStrategy("masking_strategy").default('full').notNull(),
	description: text("description"),
	isActive: boolean("is_active").default(true),
	createdBy: uuid("created_by").references(() => adminUsers.id).references(() => adminUsers.id),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
},
	(table) => {
		return {
			idxAgentSensitivityAgentId: index("idx_agent_sensitivity_agent_id").on(table.agentId),
			idxAgentSensitivityColumnId: index("idx_agent_sensitivity_column_id").on(table.columnId),
			idxAgentSensitivityActive: index("idx_agent_sensitivity_active").on(table.isActive),
		}
	});

export const forbiddenFields = pgTable("forbidden_fields", {
	id: uuid("id").default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	agentId: uuid("agent_id").references(() => agents.id, { onDelete: "cascade" }).references(() => agents.id, { onDelete: "cascade" }),
	scope: varchar("scope", { length: 20 }).default('agent').notNull(),
	tablePattern: text("table_pattern"),
	columnPattern: text("column_pattern"),
	reason: text("reason"),
	isActive: boolean("is_active").default(true),
	createdBy: uuid("created_by").references(() => adminUsers.id).references(() => adminUsers.id),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
},
	(table) => {
		return {
			idxForbiddenFieldsAgentId: index("idx_forbidden_fields_agent_id").on(table.agentId),
			idxForbiddenFieldsScope: index("idx_forbidden_fields_scope").on(table.scope),
		}
	});

export const auditLogs = pgTable("audit_logs", {
	id: uuid("id").default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }).references(() => agents.id, { onDelete: "set null" }),
	userId: uuid("user_id").references(() => adminUsers.id, { onDelete: "set null" }).references(() => adminUsers.id, { onDelete: "set null" }),
	sessionId: varchar("session_id", { length: 255 }),
	action: auditAction("action").notNull(),
	resourceType: varchar("resource_type", { length: 100 }),
	resourceId: uuid("resource_id"),
	details: jsonb("details").default({}),
	ipAddress: inet("ip_address"),
	userAgent: text("user_agent"),
	durationMs: integer("duration_ms"),
	isSuccess: boolean("is_success").default(true),
	errorMessage: text("error_message"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
},
	(table) => {
		return {
			idxAuditLogsAgentId: index("idx_audit_logs_agent_id").on(table.agentId),
			idxAuditLogsUserId: index("idx_audit_logs_user_id").on(table.userId),
			idxAuditLogsAction: index("idx_audit_logs_action").on(table.action),
			idxAuditLogsCreatedAt: index("idx_audit_logs_created_at").on(table.createdAt),
			idxAuditLogsResource: index("idx_audit_logs_resource").on(table.resourceType, table.resourceId),
		}
	});

export const queryHistory = pgTable("query_history", {
	id: uuid("id").default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }).references(() => agents.id, { onDelete: "cascade" }),
	sessionId: varchar("session_id", { length: 255 }),
	userMessage: text("user_message").notNull(),
	canonicalQuery: jsonb("canonical_query"),
	generatedSql: text("generated_sql"),
	sqlDialect: dbType("sql_dialect"),
	executionTimeMs: integer("execution_time_ms"),
	rowCount: integer("row_count"),
	isSuccess: boolean("is_success").default(true),
	errorMessage: text("error_message"),
	validationErrors: jsonb("validation_errors"),
	sanitizationApplied: jsonb("sanitization_applied"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
},
	(table) => {
		return {
			idxQueryHistoryAgentId: index("idx_query_history_agent_id").on(table.agentId),
			idxQueryHistorySessionId: index("idx_query_history_session_id").on(table.sessionId),
			idxQueryHistoryCreatedAt: index("idx_query_history_created_at").on(table.createdAt),
			idxQueryHistorySuccess: index("idx_query_history_success").on(table.isSuccess),
		}
	});

export const refreshTokens = pgTable("refresh_tokens", {
	id: uuid("id").default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	userId: uuid("user_id").notNull().references(() => adminUsers.id, { onDelete: "cascade" }).references(() => adminUsers.id, { onDelete: "cascade" }),
	tokenHash: varchar("token_hash", { length: 255 }).notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	isRevoked: boolean("is_revoked").default(false),
	revokedAt: timestamp("revoked_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
},
	(table) => {
		return {
			idxRefreshTokensUserId: index("idx_refresh_tokens_user_id").on(table.userId),
			idxRefreshTokensHash: index("idx_refresh_tokens_hash").on(table.tokenHash),
			idxRefreshTokensExpires: index("idx_refresh_tokens_expires").on(table.expiresAt),
			refreshTokensTokenHashKey: unique("refresh_tokens_token_hash_key").on(table.tokenHash),
		}
	});

export const conversations = pgTable("conversations", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
	userId: uuid("user_id").references(() => adminUsers.id, { onDelete: "set null" }),
	title: varchar("title", { length: 255 }).default('New Conversation'),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
},
	(table) => {
		return {
			idxConversationsAgentId: index("idx_conversations_agent_id").on(table.agentId),
			idxConversationsUserId: index("idx_conversations_user_id").on(table.userId),
		}
	});

export const messages = pgTable("messages", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
	role: conversationRole("role").notNull(),
	content: text("content").notNull(),
	metadata: jsonb("metadata").default({}),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	threadId: varchar("thread_id", { length: 255 }),
},
	(table) => {
		return {
			idxMessagesConversationId: index("idx_messages_conversation_id").on(table.conversationId),
			idxMessagesCreatedAt: index("idx_messages_created_at").on(table.createdAt),
			idxMessagesThreadId: index("idx_messages_thread_id").on(table.threadId),
		}
	});

export const queryThreads = pgTable("query_threads", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
	threadId: varchar("thread_id", { length: 255 }).notNull(),
	initialQuery: text("initial_query").notNull(),
	currentSql: text("current_sql"),
	metadata: jsonb("metadata").default({}),
	iterationCount: integer("iteration_count").default(1),
	status: varchar("status", { length: 50 }).default('active'),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
},
	(table) => {
		return {
			idxQueryThreadsConversation: index("idx_query_threads_conversation").on(table.conversationId),
			idxQueryThreadsThreadId: index("idx_query_threads_thread_id").on(table.threadId),
			queryThreadsThreadIdUnique: unique("query_threads_thread_id_unique").on(table.threadId),
		}
	});