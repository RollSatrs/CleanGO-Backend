CREATE TABLE "cleaner_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"is_available" boolean DEFAULT false NOT NULL,
	"service_radius_km" integer,
	"service_area" text,
	"service_types" text[],
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"last_location_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"actor_id" uuid,
	"event_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"cleaner_id" uuid NOT NULL,
	"batch_number" integer NOT NULL,
	"status" text DEFAULT 'offered' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "latitude" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "longitude" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "apartment" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "entrance" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "floor" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "address_comment" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "area_hint" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "matching_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "matching_round" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cleaner_profiles" ADD CONSTRAINT "cleaner_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_offers" ADD CONSTRAINT "order_offers_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_offers" ADD CONSTRAINT "order_offers_cleaner_id_users_id_fk" FOREIGN KEY ("cleaner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_events_order_created_idx" ON "order_events" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "order_offers_order_cleaner_uidx" ON "order_offers" USING btree ("order_id","cleaner_id");--> statement-breakpoint
CREATE INDEX "order_offers_cleaner_status_expiry_idx" ON "order_offers" USING btree ("cleaner_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "order_offers_order_status_idx" ON "order_offers" USING btree ("order_id","status");