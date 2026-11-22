ALTER TABLE "bookings" ADD COLUMN "refund_due_paise" bigint;--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_one_active_hold_per_customer" ON "bookings" USING btree ("customer_id") WHERE "bookings"."status" IN ('HELD', 'PENDING_PAYMENT');--> statement-breakpoint
CREATE INDEX "bookings_status_event_date_idx" ON "bookings" USING btree ("status","event_date");