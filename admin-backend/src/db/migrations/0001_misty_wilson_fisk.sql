CREATE TABLE IF NOT EXISTS "query_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"thread_id" varchar(255) NOT NULL,
	"initial_query" text NOT NULL,
	"current_sql" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"iteration_count" integer DEFAULT 1,
	"status" varchar(50) DEFAULT 'active',
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "query_threads_thread_id_unique" UNIQUE("thread_id")
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "thread_id" varchar(255);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_query_threads_conversation" ON "query_threads" ("conversation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_query_threads_thread_id" ON "query_threads" ("thread_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_messages_thread_id" ON "messages" ("thread_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "query_threads" ADD CONSTRAINT "query_threads_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
