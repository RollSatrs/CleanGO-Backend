ALTER TABLE "orders" ADD COLUMN "review_visibility" text NOT NULL DEFAULT 'published' CHECK ("review_visibility" IN ('published','hidden'));
--> statement-breakpoint
CREATE INDEX "orders_cleaner_review_idx" ON "orders" ("cleaner_id","status","review_visibility","reviewed_at");
