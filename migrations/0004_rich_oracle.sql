ALTER TABLE "users" ALTER COLUMN "password" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "telegram_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "telegram_username" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "telegram_photo_url" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "require_telegram_login" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_telegram_id_unique" UNIQUE("telegram_id");