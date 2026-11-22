CREATE TABLE "invoice_counters" (
	"financial_year" text PRIMARY KEY NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "booking_status_history" ADD COLUMN "notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "dedupe_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "booking_status_history_outbox_idx" ON "booking_status_history" USING btree ("created_at") WHERE "booking_status_history"."notified_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_key" ON "notifications" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "notifications_due_idx" ON "notifications" USING btree ("next_attempt_at") WHERE "notifications"."status" = 'QUEUED';--> statement-breakpoint
-- Transitions recorded before this migration are not announced retroactively.
UPDATE "booking_status_history" SET "notified_at" = now() WHERE "notified_at" IS NULL;
