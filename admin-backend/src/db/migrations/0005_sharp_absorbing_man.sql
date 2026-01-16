ALTER TABLE "query_history" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_query_history_organization_id" ON "query_history" ("organization_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "query_history" ADD CONSTRAINT "query_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
