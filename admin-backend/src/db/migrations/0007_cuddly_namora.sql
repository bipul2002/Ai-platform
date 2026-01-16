CREATE TABLE IF NOT EXISTS "agent_api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"encrypted_key" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	"last_used_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"allowed_origins" text[],
	CONSTRAINT "agent_api_keys_encrypted_key_unique" UNIQUE("encrypted_key")
);
--> statement-breakpoint
ALTER TABLE "query_history" ADD COLUMN "api_key_id" uuid;--> statement-breakpoint
ALTER TABLE "query_history" ADD COLUMN "api_key_name" varchar(255);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_api_keys_agent_id" ON "agent_api_keys" ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_agent_api_keys_encrypted_key" ON "agent_api_keys" ("encrypted_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_api_keys_created_by" ON "agent_api_keys" ("created_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_query_history_api_key_id" ON "query_history" ("api_key_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "query_history" ADD CONSTRAINT "query_history_api_key_id_agent_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "agent_api_keys"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_api_keys" ADD CONSTRAINT "agent_api_keys_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_api_keys" ADD CONSTRAINT "agent_api_keys_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "admin_users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
