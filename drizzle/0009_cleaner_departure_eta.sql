ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "travel_mode" text;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "eta_minutes" integer;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "eta_calculated_at" timestamp with time zone;
