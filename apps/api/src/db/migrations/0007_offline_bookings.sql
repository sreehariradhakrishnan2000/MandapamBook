CREATE TABLE "offline_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auditorium_id" uuid NOT NULL,
	"hall_id" uuid NOT NULL,
	"customer_name" text NOT NULL,
	"customer_phone" text NOT NULL,
	"customer_email" "citext",
	"event_type" text,
	"amount_paise" bigint,
	"advance_paise" bigint,
	"notes" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offline_bookings_status" CHECK ("offline_bookings"."status" IN ('ACTIVE', 'CANCELLED')),
	CONSTRAINT "offline_bookings_phone" CHECK ("offline_bookings"."customer_phone" ~ '^\+91[6-9][0-9]{9}$'),
	CONSTRAINT "offline_bookings_amounts" CHECK (("offline_bookings"."amount_paise" IS NULL OR "offline_bookings"."amount_paise" >= 0) AND ("offline_bookings"."advance_paise" IS NULL OR "offline_bookings"."advance_paise" >= 0))
);
--> statement-breakpoint
ALTER TABLE "availability_blocks" ADD COLUMN "offline_booking_id" uuid;--> statement-breakpoint
ALTER TABLE "offline_bookings" ADD CONSTRAINT "offline_bookings_auditorium_id_auditoriums_id_fk" FOREIGN KEY ("auditorium_id") REFERENCES "public"."auditoriums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_bookings" ADD CONSTRAINT "offline_bookings_hall_id_halls_id_fk" FOREIGN KEY ("hall_id") REFERENCES "public"."halls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_bookings" ADD CONSTRAINT "offline_bookings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "offline_bookings_auditorium_idx" ON "offline_bookings" USING btree ("auditorium_id","status");--> statement-breakpoint
CREATE INDEX "offline_bookings_phone_idx" ON "offline_bookings" USING btree ("customer_phone");--> statement-breakpoint
CREATE INDEX "offline_bookings_email_idx" ON "offline_bookings" USING btree ("customer_email");--> statement-breakpoint
ALTER TABLE "availability_blocks" ADD CONSTRAINT "availability_blocks_offline_booking_id_offline_bookings_id_fk" FOREIGN KEY ("offline_booking_id") REFERENCES "public"."offline_bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "availability_blocks_offline_idx" ON "availability_blocks" USING btree ("offline_booking_id");