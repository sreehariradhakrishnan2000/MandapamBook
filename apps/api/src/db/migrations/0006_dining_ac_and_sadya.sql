ALTER TABLE "auditoriums" ADD COLUMN "sadya_prep_area" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "auditoriums" ADD COLUMN "cooking_equipment" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "halls" ADD COLUMN "dining_is_ac" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Existing halls: assume the dining area matches the hall until the owner says otherwise.
UPDATE "halls" SET "dining_is_ac" = "is_ac";
