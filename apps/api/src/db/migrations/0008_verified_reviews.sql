ALTER TABLE "reviews" ALTER COLUMN "booking_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "offline_booking_id" uuid;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "reviewer_name" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "reviewer_email" "citext";--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "reviewer_phone" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "event_date" date;--> statement-breakpoint
-- Existing reviews: take the reviewer's details from their account and the date from the booking.
UPDATE "reviews" r
SET "reviewer_name" = u."full_name",
    "reviewer_email" = u."email",
    "reviewer_phone" = u."phone",
    "event_date" = b."event_date"
FROM "users" u, "bookings" b
WHERE u."id" = r."customer_id" AND b."id" = r."booking_id";--> statement-breakpoint
ALTER TABLE "reviews" ALTER COLUMN "reviewer_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ALTER COLUMN "reviewer_email" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ALTER COLUMN "event_date" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_offline_booking_id_offline_bookings_id_fk" FOREIGN KEY ("offline_booking_id") REFERENCES "public"."offline_bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_offline_booking_key" ON "reviews" USING btree ("offline_booking_id");--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_one_booking" CHECK (("reviews"."booking_id" IS NULL) <> ("reviews"."offline_booking_id" IS NULL));
