CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "audit_action" AS ENUM('agent_created', 'agent_updated', 'agent_deleted', 'schema_ingested', 'schema_updated', 'embedding_generated', 'embedding_updated', 'sensitivity_rule_created', 'sensitivity_rule_updated', 'sensitivity_rule_deleted', 'query_executed', 'query_failed', 'user_login', 'user_logout', 'config_updated', 'metadata_updated');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "conversation_role" AS ENUM('user', 'assistant', 'system');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "db_type" AS ENUM('postgresql', 'mysql');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "llm_provider" AS ENUM('openai', 'anthropic');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "masking_strategy" AS ENUM('full', 'partial', 'hash', 'redact', 'tokenize');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "sensitivity_level" AS ENUM('low', 'medium', 'high', 'critical');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "user_role" AS ENUM('super_admin', 'admin', 'viewer');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"role" "user_role" DEFAULT 'viewer' NOT NULL,
	"first_name" varchar(100),
	"last_name" varchar(100),
	"is_active" boolean DEFAULT true,
	"last_login_at" timestamp with time zone,
	"password_changed_at" timestamp with time zone,
	"failed_login_attempts" integer DEFAULT 0,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "admin_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_columns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"table_id" uuid NOT NULL,
	"column_name" varchar(255) NOT NULL,
	"data_type" varchar(100) NOT NULL,
	"is_nullable" boolean DEFAULT true,
	"is_primary_key" boolean DEFAULT false,
	"is_foreign_key" boolean DEFAULT false,
	"is_unique" boolean DEFAULT false,
	"is_indexed" boolean DEFAULT false,
	"default_value" text,
	"original_comment" text,
	"admin_description" text,
	"semantic_hints" text,
	"custom_prompt" text,
	"sample_values" text[],
	"value_distribution" jsonb,
	"is_visible" boolean DEFAULT true,
	"is_queryable" boolean DEFAULT true,
	"is_sensitive" boolean DEFAULT false,
	"sensitivity_override" "sensitivity_level",
	"masking_strategy_override" "masking_strategy",
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_external_db_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"db_type" "db_type" NOT NULL,
	"host" varchar(255) NOT NULL,
	"port" integer NOT NULL,
	"database_name" varchar(255) NOT NULL,
	"username" varchar(255) NOT NULL,
	"encrypted_password" text NOT NULL,
	"ssl_enabled" boolean DEFAULT false,
	"ssl_ca_cert" text,
	"ssl_client_cert" text,
	"ssl_client_key" text,
	"connection_pool_size" integer DEFAULT 5,
	"connection_timeout_ms" integer DEFAULT 5000,
	"schema_filter_include" text[] DEFAULT '{}',
	"schema_filter_exclude" text[] DEFAULT '{}',
	"last_connection_test_at" timestamp with time zone,
	"last_connection_test_success" boolean,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "agent_external_db_credentials_agent_id_unique" UNIQUE("agent_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"source_table_id" uuid NOT NULL,
	"source_column_id" uuid NOT NULL,
	"target_table_id" uuid NOT NULL,
	"target_column_id" uuid NOT NULL,
	"relationship_type" varchar(50) DEFAULT 'foreign_key',
	"is_inferred" boolean DEFAULT false,
	"confidence_score" numeric(3, 2),
	"original_constraint_name" varchar(255),
	"admin_description" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_tables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"table_name" varchar(255) NOT NULL,
	"schema_name" varchar(255) DEFAULT 'public',
	"original_comment" text,
	"admin_description" text,
	"semantic_hints" text,
	"custom_prompt" text,
	"is_visible" boolean DEFAULT true,
	"is_queryable" boolean DEFAULT true,
	"row_count_estimate" bigint,
	"last_analyzed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"tags" text[] DEFAULT '{}',
	"is_active" boolean DEFAULT true,
	"created_by" uuid,
	"last_used_at" timestamp with time zone,
	"query_count" bigint DEFAULT 0,
	"custom_dictionary" jsonb DEFAULT '{}'::jsonb,
	"system_prompt_override" text,
	"max_results_limit" integer DEFAULT 1000,
	"timeout_seconds" integer DEFAULT 30,
	"llm_provider" "llm_provider" DEFAULT 'openai',
	"llm_model" varchar(100) DEFAULT 'gpt-4-turbo-preview',
	"llm_temperature" numeric(3, 2) DEFAULT '0.00',
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"user_id" uuid,
	"title" varchar(255) DEFAULT 'New Conversation',
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" "conversation_role" NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_additional_metadata" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"metadata_type" varchar(100) NOT NULL,
	"target_type" varchar(50) NOT NULL,
	"target_id" uuid NOT NULL,
	"key" varchar(255) NOT NULL,
	"value" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_schema_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"target_type" varchar(50) NOT NULL,
	"target_id" uuid NOT NULL,
	"embedding_text" text NOT NULL,
	"embedding_vector" vector(1536),
	"embedding_model" varchar(100) DEFAULT 'text-embedding-3-small',
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid,
	"user_id" uuid,
	"session_id" varchar(255),
	"action" "audit_action" NOT NULL,
	"resource_type" varchar(100),
	"resource_id" uuid,
	"details" jsonb DEFAULT '{}'::jsonb,
	"ip_address" "inet",
	"user_agent" text,
	"duration_ms" integer,
	"is_success" boolean DEFAULT true,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"session_token" varchar(255) NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb,
	"message_count" integer DEFAULT 0,
	"last_message_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "chat_sessions_session_token_unique" UNIQUE("session_token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "forbidden_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid,
	"scope" varchar(20) DEFAULT 'agent' NOT NULL,
	"table_pattern" text,
	"column_pattern" text,
	"reason" text,
	"is_active" boolean DEFAULT true,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "query_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"session_id" varchar(255),
	"user_message" text NOT NULL,
	"canonical_query" jsonb,
	"generated_sql" text,
	"sql_dialect" "db_type",
	"execution_time_ms" integer,
	"row_count" integer,
	"is_success" boolean DEFAULT true,
	"error_message" text,
	"validation_errors" jsonb,
	"sanitization_applied" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(255) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"is_revoked" boolean DEFAULT false,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sensitive_field_registry_agent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"column_id" uuid,
	"pattern_type" varchar(50),
	"pattern_value" text,
	"pattern_regex" text,
	"sensitivity_level" "sensitivity_level" DEFAULT 'high' NOT NULL,
	"masking_strategy" "masking_strategy" DEFAULT 'full' NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sensitive_field_registry_global" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pattern_type" varchar(50) NOT NULL,
	"pattern_value" text NOT NULL,
	"pattern_regex" text,
	"sensitivity_level" "sensitivity_level" DEFAULT 'high' NOT NULL,
	"masking_strategy" "masking_strategy" DEFAULT 'full' NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_admin_users_email" ON "admin_users" ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_admin_users_role" ON "admin_users" ("role");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_columns_agent_id" ON "agent_columns" ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_columns_table_id" ON "agent_columns" ("table_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_columns_name" ON "agent_columns" ("column_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_columns_sensitive" ON "agent_columns" ("is_sensitive");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unique_table_column" ON "agent_columns" ("table_id","column_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_ext_db_agent_id" ON "agent_external_db_credentials" ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_relationships_agent_id" ON "agent_relationships" ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_relationships_source_table" ON "agent_relationships" ("source_table_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_relationships_target_table" ON "agent_relationships" ("target_table_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_tables_agent_id" ON "agent_tables" ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_tables_name" ON "agent_tables" ("table_name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unique_agent_table" ON "agent_tables" ("agent_id","schema_name","table_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agents_name" ON "agents" ("name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agents_is_active" ON "agents" ("is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agents_created_by" ON "agents" ("created_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_conversations_agent_id" ON "conversations" ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_conversations_user_id" ON "conversations" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_messages_conversation_id" ON "messages" ("conversation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_messages_created_at" ON "messages" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_metadata_agent_id" ON "agent_additional_metadata" ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_metadata_target" ON "agent_additional_metadata" ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unique_agent_metadata" ON "agent_additional_metadata" ("agent_id","target_type","target_id","key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_schema_embeddings_agent_id" ON "agent_schema_embeddings" ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_schema_embeddings_target" ON "agent_schema_embeddings" ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unique_agent_embedding" ON "agent_schema_embeddings" ("agent_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_logs_agent_id" ON "audit_logs" ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_logs_user_id" ON "audit_logs" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_logs_action" ON "audit_logs" ("action");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_logs_created_at" ON "audit_logs" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_logs_resource" ON "audit_logs" ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_chat_sessions_agent_id" ON "chat_sessions" ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_chat_sessions_token" ON "chat_sessions" ("session_token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_forbidden_fields_agent_id" ON "forbidden_fields" ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_forbidden_fields_scope" ON "forbidden_fields" ("scope");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_query_history_agent_id" ON "query_history" ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_query_history_session_id" ON "query_history" ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_query_history_created_at" ON "query_history" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_query_history_success" ON "query_history" ("is_success");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_refresh_tokens_user_id" ON "refresh_tokens" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_refresh_tokens_hash" ON "refresh_tokens" ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_refresh_tokens_expires" ON "refresh_tokens" ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_sensitivity_agent_id" ON "sensitive_field_registry_agent" ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_sensitivity_column_id" ON "sensitive_field_registry_agent" ("column_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_sensitivity_active" ON "sensitive_field_registry_agent" ("is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_global_sensitivity_pattern" ON "sensitive_field_registry_global" ("pattern_type","pattern_value");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_global_sensitivity_active" ON "sensitive_field_registry_global" ("is_active");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_columns" ADD CONSTRAINT "agent_columns_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_columns" ADD CONSTRAINT "agent_columns_table_id_agent_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "agent_tables"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_external_db_credentials" ADD CONSTRAINT "agent_external_db_credentials_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_relationships" ADD CONSTRAINT "agent_relationships_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_relationships" ADD CONSTRAINT "agent_relationships_source_table_id_agent_tables_id_fk" FOREIGN KEY ("source_table_id") REFERENCES "agent_tables"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_relationships" ADD CONSTRAINT "agent_relationships_source_column_id_agent_columns_id_fk" FOREIGN KEY ("source_column_id") REFERENCES "agent_columns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_relationships" ADD CONSTRAINT "agent_relationships_target_table_id_agent_tables_id_fk" FOREIGN KEY ("target_table_id") REFERENCES "agent_tables"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_relationships" ADD CONSTRAINT "agent_relationships_target_column_id_agent_columns_id_fk" FOREIGN KEY ("target_column_id") REFERENCES "agent_columns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_tables" ADD CONSTRAINT "agent_tables_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agents" ADD CONSTRAINT "agents_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "admin_users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations" ADD CONSTRAINT "conversations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_admin_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "admin_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_additional_metadata" ADD CONSTRAINT "agent_additional_metadata_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_additional_metadata" ADD CONSTRAINT "agent_additional_metadata_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "admin_users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_schema_embeddings" ADD CONSTRAINT "agent_schema_embeddings_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_admin_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "admin_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "forbidden_fields" ADD CONSTRAINT "forbidden_fields_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "forbidden_fields" ADD CONSTRAINT "forbidden_fields_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "admin_users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "query_history" ADD CONSTRAINT "query_history_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_admin_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "admin_users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sensitive_field_registry_agent" ADD CONSTRAINT "sensitive_field_registry_agent_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sensitive_field_registry_agent" ADD CONSTRAINT "sensitive_field_registry_agent_column_id_agent_columns_id_fk" FOREIGN KEY ("column_id") REFERENCES "agent_columns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sensitive_field_registry_agent" ADD CONSTRAINT "sensitive_field_registry_agent_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "admin_users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sensitive_field_registry_global" ADD CONSTRAINT "sensitive_field_registry_global_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "admin_users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
