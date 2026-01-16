ALTER TABLE "audit_logs" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_logs_organization_id" ON "audit_logs" ("organization_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
