ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'schema_refreshed';--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "disabled_sensitivity_rules" text[] DEFAULT '{}';