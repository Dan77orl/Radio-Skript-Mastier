ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "storage_provider" text DEFAULT 'yandex';--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "google_drive_refresh_token" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "google_drive_folder_id" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "google_drive_email" text;