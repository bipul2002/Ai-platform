ALTER TABLE "conversations" ADD COLUMN "api_key_id" uuid;--> statement-breakpoint
ALTER TABLE "query_history" ADD COLUMN "user_id" uuid;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_conversations_api_key_id" ON "conversations" ("api_key_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_query_history_user_id" ON "query_history" ("user_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations" ADD CONSTRAINT "conversations_api_key_id_agent_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "agent_api_keys"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "query_history" ADD CONSTRAINT "query_history_user_id_admin_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "admin_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "agent_columns" DROP COLUMN IF EXISTS "admin_notes";--> statement-breakpoint
ALTER TABLE "agent_relationships" DROP COLUMN IF EXISTS "admin_notes";--> statement-breakpoint
ALTER TABLE "agent_tables" DROP COLUMN IF EXISTS "admin_notes";