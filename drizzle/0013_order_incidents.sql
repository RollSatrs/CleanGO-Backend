CREATE TABLE "order_incidents" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 "order_id" uuid NOT NULL REFERENCES "orders"("id"),
 "actor_id" uuid NOT NULL REFERENCES "users"("id"),
 "actor_role" text NOT NULL,
 "cleaner_id" uuid REFERENCES "users"("id"),
 "kind" text NOT NULL,
 "reason" text NOT NULL,
 "comment" text,
 "photos" text[],
 "previous_status" text NOT NULL,
 "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "order_incidents_order_created_idx" ON "order_incidents" ("order_id","created_at");
--> statement-breakpoint
CREATE INDEX "order_incidents_cleaner_kind_idx" ON "order_incidents" ("cleaner_id","kind");
