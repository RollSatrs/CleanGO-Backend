-- Apply once to the PostgreSQL database used by CleanGo.
CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "telegram_id" text NOT NULL UNIQUE,
  "phone" text,
  "first_name" text,
  "last_name" text,
  "role" text NOT NULL DEFAULT 'unselected',
  "cleaner_status" text NOT NULL DEFAULT 'not_applied',
  "created_at" timestamptz NOT NULL DEFAULT now()
);
