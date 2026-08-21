CREATE TABLE IF NOT EXISTS "jobs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"progress" text,
	"result" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"last_error" text,
	"run_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"locked_at" timestamp,
	"locked_by" text,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_claim_idx" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_user_idx" ON "jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_type_idx" ON "jobs" USING btree ("type");