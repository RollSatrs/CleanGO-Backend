CREATE TABLE "user_avatars" (
  "user_id" uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "image" text NOT NULL CHECK (length("image") <= 180000),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
