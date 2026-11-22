-- Database-level integrity rules that Drizzle cannot express in the schema DSL.
-- These are the last line of defence: they hold even if application code has a bug.

-- 1. No double booking ------------------------------------------------------------
-- Two ACTIVE occupancy rows for the same hall and date may not have overlapping slot
-- spans. MORNING [0,1) and EVENING [1,2) can coexist; FULL_DAY [0,2) overlaps both.
-- A violating insert/update fails with SQLSTATE 23P01 (exclusion_violation).
ALTER TABLE "hall_occupancy"
  ADD CONSTRAINT "hall_occupancy_no_overlap"
  EXCLUDE USING gist ("hall_id" WITH =, "event_date" WITH =, "slot_span" WITH &&)
  WHERE ("active");
--> statement-breakpoint

-- 2. A booking's hall must belong to the booking's auditorium ----------------------
ALTER TABLE "halls" ADD CONSTRAINT "halls_id_auditorium_key" UNIQUE ("id", "auditorium_id");
--> statement-breakpoint
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_hall_auditorium_fk"
  FOREIGN KEY ("hall_id", "auditorium_id") REFERENCES "halls" ("id", "auditorium_id")
  ON DELETE RESTRICT;
--> statement-breakpoint

-- 3. Keep hall_occupancy in step with bookings ------------------------------------
-- Occupancy rows are created and toggled only here, so the application cannot forget.
-- Keep the active-status list in sync with ACTIVE_BOOKING_STATUSES in schema/enums.ts.
CREATE FUNCTION "booking_occupancy_sync"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  is_active boolean := NEW.status IN ('HELD', 'PENDING_PAYMENT', 'AWAITING_OWNER', 'CONFIRMED', 'COMPLETED');
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO hall_occupancy (hall_id, event_date, slot, booking_id, active)
    VALUES (NEW.hall_id, NEW.event_date, NEW.slot, NEW.id, is_active);
  ELSE
    IF (NEW.hall_id, NEW.event_date, NEW.slot) IS DISTINCT FROM (OLD.hall_id, OLD.event_date, OLD.slot) THEN
      RAISE EXCEPTION 'hall, date and slot of booking % cannot be changed; create a new booking', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      UPDATE hall_occupancy SET active = is_active, updated_at = now() WHERE booking_id = NEW.id;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "bookings_occupancy_sync"
  AFTER INSERT OR UPDATE ON "bookings"
  FOR EACH ROW EXECUTE FUNCTION "booking_occupancy_sync"();
--> statement-breakpoint

CREATE FUNCTION "block_occupancy_sync"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO hall_occupancy (hall_id, event_date, slot, block_id, active)
    VALUES (NEW.hall_id, NEW.event_date, NEW.slot, NEW.id, true);
  ELSIF (NEW.hall_id, NEW.event_date, NEW.slot) IS DISTINCT FROM (OLD.hall_id, OLD.event_date, OLD.slot) THEN
    RAISE EXCEPTION 'hall, date and slot of block % cannot be changed; delete and re-create it', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "availability_blocks_occupancy_sync"
  AFTER INSERT OR UPDATE ON "availability_blocks"
  FOR EACH ROW EXECUTE FUNCTION "block_occupancy_sync"();
--> statement-breakpoint
-- Deleting a block deletes its occupancy row through the ON DELETE CASCADE foreign key.

-- 4. Audit log is append-only -----------------------------------------------------
CREATE FUNCTION "audit_logs_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only (% rejected)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "audit_logs_no_update_delete"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "audit_logs_append_only"();
--> statement-breakpoint
CREATE TRIGGER "audit_logs_no_truncate"
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit_logs_append_only"();
--> statement-breakpoint

-- 5. updated_at maintenance -------------------------------------------------------
CREATE FUNCTION "set_updated_at"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'updated_at'
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t || '_set_updated_at', t);
  END LOOP;
END;
$$;
