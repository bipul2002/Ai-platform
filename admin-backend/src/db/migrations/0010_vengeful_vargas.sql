CREATE TABLE IF NOT EXISTS "user_agent_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"granted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_agent_access_user_id" ON "user_agent_access" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_agent_access_agent_id" ON "user_agent_access" ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unique_user_agent_access" ON "user_agent_access" ("user_id","agent_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_agent_access" ADD CONSTRAINT "user_agent_access_user_id_admin_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "admin_users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_agent_access" ADD CONSTRAINT "user_agent_access_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_agent_access" ADD CONSTRAINT "user_agent_access_granted_by_admin_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "admin_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
