CREATE TABLE IF NOT EXISTS "query_llm_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"query_history_id" uuid NOT NULL,
	"node_name" varchar(100) NOT NULL,
	"llm_provider" varchar(50) NOT NULL,
	"llm_model" varchar(100) NOT NULL,
	"system_prompt" text,
	"prompt" text NOT NULL,
	"response" text,
	"llm_config" jsonb,
	"token_usage" jsonb,
	"duration_ms" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "query_pipeline_execution" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"query_history_id" uuid NOT NULL,
	"node_name" varchar(100) NOT NULL,
	"execution_order" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"node_state" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "query_history" ADD COLUMN "thread_id" varchar(255);--> statement-breakpoint
ALTER TABLE "query_history" ADD COLUMN "is_refinement" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "query_history" ADD COLUMN "iteration_count" integer DEFAULT 1;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_llm_calls_query_id" ON "query_llm_calls" ("query_history_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_llm_calls_node_name" ON "query_llm_calls" ("node_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_llm_calls_provider" ON "query_llm_calls" ("llm_provider");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_llm_calls_model" ON "query_llm_calls" ("llm_model");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_llm_calls_created_at" ON "query_llm_calls" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pipeline_exec_query_id" ON "query_pipeline_execution" ("query_history_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pipeline_exec_node_name" ON "query_pipeline_execution" ("node_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pipeline_exec_started_at" ON "query_pipeline_execution" ("started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_query_history_thread_id" ON "query_history" ("thread_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_query_history_is_refinement" ON "query_history" ("is_refinement");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "query_llm_calls" ADD CONSTRAINT "query_llm_calls_query_history_id_query_history_id_fk" FOREIGN KEY ("query_history_id") REFERENCES "query_history"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "query_pipeline_execution" ADD CONSTRAINT "query_pipeline_execution_query_history_id_query_history_id_fk" FOREIGN KEY ("query_history_id") REFERENCES "query_history"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
