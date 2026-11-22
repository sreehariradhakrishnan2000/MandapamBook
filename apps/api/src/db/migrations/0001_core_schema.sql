CREATE TYPE "public"."addon_unit" AS ENUM('PER_EVENT', 'PER_ROOM', 'PER_HOUR');--> statement-breakpoint
CREATE TYPE "public"."booking_slot" AS ENUM('MORNING', 'EVENING', 'FULL_DAY');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('HELD', 'PENDING_PAYMENT', 'AWAITING_OWNER', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."catering_policy" AS ENUM('IN_HOUSE_ONLY', 'OUTSIDE_ALLOWED', 'NO_CATERING');--> statement-breakpoint
CREATE TYPE "public"."decoration_policy" AS ENUM('IN_HOUSE_ONLY', 'OUTSIDE_ALLOWED', 'NOT_ALLOWED');--> statement-breakpoint
CREATE TYPE "public"."email_token_purpose" AS ENUM('VERIFY_EMAIL', 'PASSWORD_RESET');--> statement-breakpoint
CREATE TYPE "public"."kyc_status" AS ENUM('NOT_STARTED', 'SUBMITTED', 'VERIFIED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."listing_status" AS ENUM('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."media_status" AS ENUM('PENDING_UPLOAD', 'READY', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('EMAIL', 'SMS');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('QUEUED', 'SENT', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."otp_purpose" AS ENUM('PHONE_VERIFY', 'LOGIN', 'PASSWORD_RESET');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('CREATED', 'PENDING', 'CAPTURED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('PENDING', 'SCHEDULED', 'PAID', 'ON_HOLD');--> statement-breakpoint
CREATE TYPE "public"."pricing_rule_kind" AS ENUM('BASE', 'WEEKEND', 'SEASONAL', 'MUHURTHAM', 'DATE_OVERRIDE');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('PENDING', 'PROCESSED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('PUBLISHED', 'HIDDEN', 'FLAGGED');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('SUPER_ADMIN', 'ADMIN', 'OWNER', 'OWNER_STAFF', 'CUSTOMER');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"actor_role" "user_role",
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"ip" "inet",
	"user_agent" text,
	"correlation_id" text,
	"success" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" "email_token_purpose" NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"phone" text NOT NULL,
	"purpose" "otp_purpose" NOT NULL,
	"code_hash" "bytea" NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "otp_challenges_attempts" CHECK ("otp_challenges"."attempts" BETWEEN 0 AND 10)
);
--> statement-breakpoint
CREATE TABLE "owner_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"business_name" text NOT NULL,
	"pan_enc" "bytea",
	"pan_last4" text,
	"gstin" text,
	"bank_account_enc" "bytea",
	"bank_account_last4" text,
	"ifsc_enc" "bytea",
	"bank_account_name" text,
	"kyc_status" "kyc_status" DEFAULT 'NOT_STARTED' NOT NULL,
	"kyc_reviewed_by" uuid,
	"kyc_reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owner_profiles_gstin_format" CHECK ("owner_profiles"."gstin" IS NULL OR "owner_profiles"."gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$')
);
--> statement-breakpoint
CREATE TABLE "owner_staff" (
	"owner_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"auditorium_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owner_staff_owner_id_user_id_pk" PRIMARY KEY("owner_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"device_info" text,
	"ip" "inet",
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"replaced_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" "citext" NOT NULL,
	"phone" text,
	"full_name" text NOT NULL,
	"password_hash" text,
	"role" "user_role" DEFAULT 'CUSTOMER' NOT NULL,
	"status" "user_status" DEFAULT 'PENDING_VERIFICATION' NOT NULL,
	"email_verified_at" timestamp with time zone,
	"phone_verified_at" timestamp with time zone,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"permissions_version" integer DEFAULT 1 NOT NULL,
	"preferred_locale" text DEFAULT 'en' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_phone_e164" CHECK ("users"."phone" IS NULL OR "users"."phone" ~ '^\+91[6-9][0-9]{9}$'),
	CONSTRAINT "users_locale" CHECK ("users"."preferred_locale" IN ('en', 'ml', 'hi', 'ta')),
	CONSTRAINT "users_failed_login_count" CHECK ("users"."failed_login_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "addons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auditorium_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"unit" "addon_unit" DEFAULT 'PER_EVENT' NOT NULL,
	"price_paise" bigint NOT NULL,
	"max_quantity" smallint DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "addons_price" CHECK ("addons"."price_paise" >= 0),
	CONSTRAINT "addons_max_quantity" CHECK ("addons"."max_quantity" BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE TABLE "amenities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"name_i18n" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"icon" text,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "amenities_code_format" CHECK ("amenities"."code" ~ '^[a-z0-9_]+$')
);
--> statement-breakpoint
CREATE TABLE "auditorium_amenities" (
	"auditorium_id" uuid NOT NULL,
	"amenity_id" uuid NOT NULL,
	CONSTRAINT "auditorium_amenities_auditorium_id_amenity_id_pk" PRIMARY KEY("auditorium_id","amenity_id")
);
--> statement-breakpoint
CREATE TABLE "auditoriums" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"city_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"address_line" text NOT NULL,
	"locality" text,
	"pincode" text NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"status" "listing_status" DEFAULT 'DRAFT' NOT NULL,
	"rejection_reason" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"catering_policy" "catering_policy" NOT NULL,
	"decoration_policy" "decoration_policy" NOT NULL,
	"parking_cars" integer DEFAULT 0 NOT NULL,
	"parking_two_wheelers" integer DEFAULT 0 NOT NULL,
	"guest_rooms" integer DEFAULT 0 NOT NULL,
	"has_generator" boolean DEFAULT false NOT NULL,
	"advance_percent" smallint DEFAULT 25 NOT NULL,
	"instant_book" boolean DEFAULT true NOT NULL,
	"rating_avg" numeric(3, 2),
	"rating_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auditoriums_pincode" CHECK ("auditoriums"."pincode" ~ '^[1-9][0-9]{5}$'),
	CONSTRAINT "auditoriums_advance_percent" CHECK ("auditoriums"."advance_percent" BETWEEN 10 AND 100),
	CONSTRAINT "auditoriums_counts_non_negative" CHECK ("auditoriums"."parking_cars" >= 0 AND "auditoriums"."parking_two_wheelers" >= 0 AND "auditoriums"."guest_rooms" >= 0),
	CONSTRAINT "auditoriums_coordinates" CHECK (("auditoriums"."latitude" IS NULL AND "auditoriums"."longitude" IS NULL) OR ("auditoriums"."latitude" BETWEEN 6 AND 37 AND "auditoriums"."longitude" BETWEEN 68 AND 98)),
	CONSTRAINT "auditoriums_rating" CHECK ("auditoriums"."rating_avg" IS NULL OR "auditoriums"."rating_avg" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE "availability_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hall_id" uuid NOT NULL,
	"event_date" date NOT NULL,
	"slot" "booking_slot" NOT NULL,
	"reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cancellation_policies" (
	"auditorium_id" uuid PRIMARY KEY NOT NULL,
	"tiers" jsonb NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cancellation_policies_tiers_array" CHECK (jsonb_typeof("cancellation_policies"."tiers") = 'array')
);
--> statement-breakpoint
CREATE TABLE "cities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"district" text NOT NULL,
	"state" text NOT NULL,
	"name_i18n" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cities_slug_format" CHECK ("cities"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "halls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auditorium_id" uuid NOT NULL,
	"name" text NOT NULL,
	"seating_capacity" integer NOT NULL,
	"dining_capacity" integer DEFAULT 0 NOT NULL,
	"is_ac" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "halls_capacity" CHECK ("halls"."seating_capacity" > 0 AND "halls"."dining_capacity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auditorium_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"alt_text" text DEFAULT '' NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"status" "media_status" DEFAULT 'PENDING_UPLOAD' NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_mime" CHECK ("media"."mime_type" IN ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "media_size" CHECK ("media"."size_bytes" > 0 AND "media"."size_bytes" <= 10485760)
);
--> statement-breakpoint
CREATE TABLE "muhurtham_dates" (
	"date" date PRIMARY KEY NOT NULL,
	"label" text,
	"state" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricing_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hall_id" uuid NOT NULL,
	"slot" "booking_slot" NOT NULL,
	"kind" "pricing_rule_kind" NOT NULL,
	"valid_from" date,
	"valid_to" date,
	"price_paise" bigint NOT NULL,
	"priority" smallint DEFAULT 0 NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_rules_price" CHECK ("pricing_rules"."price_paise" > 0),
	CONSTRAINT "pricing_rules_range" CHECK ("pricing_rules"."valid_from" IS NULL OR "pricing_rules"."valid_to" IS NULL OR "pricing_rules"."valid_from" <= "pricing_rules"."valid_to"),
	CONSTRAINT "pricing_rules_kind_dates" CHECK (("pricing_rules"."kind" IN ('BASE', 'WEEKEND', 'MUHURTHAM')) OR ("pricing_rules"."valid_from" IS NOT NULL AND "pricing_rules"."valid_to" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "booking_addons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"addon_id" uuid NOT NULL,
	"quantity" smallint NOT NULL,
	"unit_price_paise" bigint NOT NULL,
	"total_paise" bigint NOT NULL,
	CONSTRAINT "booking_addons_quantity" CHECK ("booking_addons"."quantity" > 0),
	CONSTRAINT "booking_addons_total" CHECK ("booking_addons"."total_paise" = "booking_addons"."quantity" * "booking_addons"."unit_price_paise")
);
--> statement-breakpoint
CREATE TABLE "booking_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"from_status" "booking_status",
	"to_status" "booking_status" NOT NULL,
	"actor_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref_code" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"auditorium_id" uuid NOT NULL,
	"hall_id" uuid NOT NULL,
	"event_date" date NOT NULL,
	"slot" "booking_slot" NOT NULL,
	"guest_count" integer NOT NULL,
	"status" "booking_status" DEFAULT 'HELD' NOT NULL,
	"hold_expires_at" timestamp with time zone,
	"owner_response_due_at" timestamp with time zone,
	"subtotal_paise" bigint NOT NULL,
	"addons_paise" bigint DEFAULT 0 NOT NULL,
	"gst_paise" bigint NOT NULL,
	"platform_fee_paise" bigint NOT NULL,
	"total_paise" bigint NOT NULL,
	"advance_paise" bigint NOT NULL,
	"balance_received_at" timestamp with time zone,
	"price_snapshot" jsonb NOT NULL,
	"cancellation_reason" text,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_guest_count" CHECK ("bookings"."guest_count" > 0),
	CONSTRAINT "bookings_amounts_non_negative" CHECK ("bookings"."subtotal_paise" >= 0 AND "bookings"."addons_paise" >= 0 AND "bookings"."gst_paise" >= 0 AND "bookings"."platform_fee_paise" >= 0 AND "bookings"."advance_paise" >= 0),
	CONSTRAINT "bookings_total_matches" CHECK ("bookings"."total_paise" = "bookings"."subtotal_paise" + "bookings"."addons_paise" + "bookings"."gst_paise" + "bookings"."platform_fee_paise"),
	CONSTRAINT "bookings_advance_le_total" CHECK ("bookings"."advance_paise" <= "bookings"."total_paise"),
	CONSTRAINT "bookings_hold_has_expiry" CHECK ("bookings"."status" NOT IN ('HELD', 'PENDING_PAYMENT') OR "bookings"."hold_expires_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "hall_occupancy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hall_id" uuid NOT NULL,
	"event_date" date NOT NULL,
	"slot" "booking_slot" NOT NULL,
	"slot_span" "int4range" GENERATED ALWAYS AS (CASE slot WHEN 'MORNING' THEN int4range(0, 1) WHEN 'EVENING' THEN int4range(1, 2) ELSE int4range(0, 2) END) STORED NOT NULL,
	"booking_id" uuid,
	"block_id" uuid,
	"active" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hall_occupancy_one_source" CHECK (("hall_occupancy"."booking_id" IS NOT NULL) <> ("hall_occupancy"."block_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"number" text NOT NULL,
	"storage_key" text,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"channel" "notification_channel" NOT NULL,
	"template" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "notification_status" DEFAULT 'QUEUED' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"provider_message_id" text,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_order_id" text NOT NULL,
	"provider_payment_id" text,
	"status" "payment_status" DEFAULT 'CREATED' NOT NULL,
	"amount_paise" bigint NOT NULL,
	"refunded_paise" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"idempotency_key" text NOT NULL,
	"raw_payload" jsonb,
	"captured_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount" CHECK ("payments"."amount_paise" > 0),
	CONSTRAINT "payments_refunded_le_amount" CHECK ("payments"."refunded_paise" >= 0 AND "payments"."refunded_paise" <= "payments"."amount_paise"),
	CONSTRAINT "payments_currency" CHECK ("payments"."currency" = 'INR')
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"gross_paise" bigint NOT NULL,
	"commission_paise" bigint NOT NULL,
	"net_paise" bigint NOT NULL,
	"status" "payout_status" DEFAULT 'PENDING' NOT NULL,
	"reference" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payouts_amounts" CHECK ("payouts"."gross_paise" >= 0 AND "payouts"."commission_paise" >= 0 AND "payouts"."net_paise" = "payouts"."gross_paise" - "payouts"."commission_paise")
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"amount_paise" bigint NOT NULL,
	"status" "refund_status" DEFAULT 'PENDING' NOT NULL,
	"provider_refund_id" text,
	"idempotency_key" text NOT NULL,
	"reason" text NOT NULL,
	"initiated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_amount" CHECK ("refunds"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"auditorium_id" uuid NOT NULL,
	"rating" smallint NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"status" "review_status" DEFAULT 'PUBLISHED' NOT NULL,
	"owner_reply" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_rating" CHECK ("reviews"."rating" BETWEEN 1 AND 5),
	CONSTRAINT "reviews_body_length" CHECK (char_length("reviews"."body") <= 4000)
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"processing_error" text
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_tokens" ADD CONSTRAINT "email_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_profiles" ADD CONSTRAINT "owner_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_profiles" ADD CONSTRAINT "owner_profiles_kyc_reviewed_by_users_id_fk" FOREIGN KEY ("kyc_reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_staff" ADD CONSTRAINT "owner_staff_owner_id_owner_profiles_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_staff" ADD CONSTRAINT "owner_staff_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_staff" ADD CONSTRAINT "owner_staff_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addons" ADD CONSTRAINT "addons_auditorium_id_auditoriums_id_fk" FOREIGN KEY ("auditorium_id") REFERENCES "public"."auditoriums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auditorium_amenities" ADD CONSTRAINT "auditorium_amenities_auditorium_id_auditoriums_id_fk" FOREIGN KEY ("auditorium_id") REFERENCES "public"."auditoriums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auditorium_amenities" ADD CONSTRAINT "auditorium_amenities_amenity_id_amenities_id_fk" FOREIGN KEY ("amenity_id") REFERENCES "public"."amenities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auditoriums" ADD CONSTRAINT "auditoriums_owner_id_owner_profiles_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_profiles"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auditoriums" ADD CONSTRAINT "auditoriums_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auditoriums" ADD CONSTRAINT "auditoriums_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_blocks" ADD CONSTRAINT "availability_blocks_hall_id_halls_id_fk" FOREIGN KEY ("hall_id") REFERENCES "public"."halls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_blocks" ADD CONSTRAINT "availability_blocks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation_policies" ADD CONSTRAINT "cancellation_policies_auditorium_id_auditoriums_id_fk" FOREIGN KEY ("auditorium_id") REFERENCES "public"."auditoriums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "halls" ADD CONSTRAINT "halls_auditorium_id_auditoriums_id_fk" FOREIGN KEY ("auditorium_id") REFERENCES "public"."auditoriums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_auditorium_id_auditoriums_id_fk" FOREIGN KEY ("auditorium_id") REFERENCES "public"."auditoriums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_hall_id_halls_id_fk" FOREIGN KEY ("hall_id") REFERENCES "public"."halls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_addons" ADD CONSTRAINT "booking_addons_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_addons" ADD CONSTRAINT "booking_addons_addon_id_addons_id_fk" FOREIGN KEY ("addon_id") REFERENCES "public"."addons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_status_history" ADD CONSTRAINT "booking_status_history_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_status_history" ADD CONSTRAINT "booking_status_history_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_auditorium_id_auditoriums_id_fk" FOREIGN KEY ("auditorium_id") REFERENCES "public"."auditoriums"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_hall_id_halls_id_fk" FOREIGN KEY ("hall_id") REFERENCES "public"."halls"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hall_occupancy" ADD CONSTRAINT "hall_occupancy_hall_id_halls_id_fk" FOREIGN KEY ("hall_id") REFERENCES "public"."halls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hall_occupancy" ADD CONSTRAINT "hall_occupancy_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hall_occupancy" ADD CONSTRAINT "hall_occupancy_block_id_availability_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."availability_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_owner_id_owner_profiles_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_profiles"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_initiated_by_users_id_fk" FOREIGN KEY ("initiated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_auditorium_id_auditoriums_id_fk" FOREIGN KEY ("auditorium_id") REFERENCES "public"."auditoriums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_tokens_hash_key" ON "email_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "otp_challenges_phone_idx" ON "otp_challenges" USING btree ("phone","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "owner_staff_user_key" ON "owner_staff" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_tokens_hash_key" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_idx" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_key" ON "users" USING btree ("phone") WHERE "users"."phone" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "addons_auditorium_code_key" ON "addons" USING btree ("auditorium_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "amenities_code_key" ON "amenities" USING btree ("code");--> statement-breakpoint
CREATE INDEX "auditorium_amenities_amenity_idx" ON "auditorium_amenities" USING btree ("amenity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auditoriums_slug_key" ON "auditoriums" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "auditoriums_owner_idx" ON "auditoriums" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "auditoriums_city_status_idx" ON "auditoriums" USING btree ("city_id","status");--> statement-breakpoint
CREATE INDEX "auditoriums_name_trgm_idx" ON "auditoriums" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "availability_blocks_hall_date_idx" ON "availability_blocks" USING btree ("hall_id","event_date");--> statement-breakpoint
CREATE UNIQUE INDEX "cities_slug_key" ON "cities" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "halls_auditorium_idx" ON "halls" USING btree ("auditorium_id");--> statement-breakpoint
CREATE INDEX "halls_capacity_idx" ON "halls" USING btree ("seating_capacity");--> statement-breakpoint
CREATE UNIQUE INDEX "halls_auditorium_name_key" ON "halls" USING btree ("auditorium_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "media_storage_key_key" ON "media" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "media_auditorium_idx" ON "media" USING btree ("auditorium_id","sort_order");--> statement-breakpoint
CREATE INDEX "pricing_rules_hall_slot_idx" ON "pricing_rules" USING btree ("hall_id","slot");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_addons_booking_addon_key" ON "booking_addons" USING btree ("booking_id","addon_id");--> statement-breakpoint
CREATE INDEX "booking_status_history_booking_idx" ON "booking_status_history" USING btree ("booking_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_ref_code_key" ON "bookings" USING btree ("ref_code");--> statement-breakpoint
CREATE INDEX "bookings_customer_idx" ON "bookings" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "bookings_auditorium_date_idx" ON "bookings" USING btree ("auditorium_id","event_date");--> statement-breakpoint
CREATE INDEX "bookings_hold_expiry_idx" ON "bookings" USING btree ("hold_expires_at") WHERE "bookings"."status" IN ('HELD', 'PENDING_PAYMENT');--> statement-breakpoint
CREATE UNIQUE INDEX "hall_occupancy_booking_key" ON "hall_occupancy" USING btree ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hall_occupancy_block_key" ON "hall_occupancy" USING btree ("block_id");--> statement-breakpoint
CREATE INDEX "hall_occupancy_calendar_idx" ON "hall_occupancy" USING btree ("hall_id","event_date") WHERE "hall_occupancy"."active";--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_booking_key" ON "invoices" USING btree ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices" USING btree ("number");--> statement-breakpoint
CREATE INDEX "notifications_status_idx" ON "notifications" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_idempotency_key" ON "payments" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_order_key" ON "payments" USING btree ("provider","provider_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_payment_key" ON "payments" USING btree ("provider","provider_payment_id") WHERE "payments"."provider_payment_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "payments_booking_idx" ON "payments" USING btree ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payouts_booking_key" ON "payouts" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "payouts_owner_idx" ON "payouts" USING btree ("owner_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_idempotency_key" ON "refunds" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "refunds_payment_idx" ON "refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_booking_key" ON "reviews" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "reviews_auditorium_idx" ON "reviews" USING btree ("auditorium_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_provider_event_key" ON "webhook_events" USING btree ("provider","event_id");