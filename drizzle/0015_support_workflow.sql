ALTER TABLE "order_incidents"
 ADD COLUMN "support_status" text CHECK ("support_status" IN ('open','in_review','resolved')),
 ADD COLUMN "support_assigned_to" uuid REFERENCES "users"("id"),
 ADD COLUMN "support_response" text,
 ADD COLUMN "support_resolved_at" timestamptz,
 ADD COLUMN "support_updated_at" timestamptz;
--> statement-breakpoint
UPDATE "order_incidents" SET "support_status"='open',"support_updated_at"="created_at"
WHERE "kind" IN ('issue','review_report') OR ("kind"='release' AND "reason" IN ('client_absent','client_unreachable')) OR ("kind"='cancel' AND "previous_status"='arrived');
--> statement-breakpoint
CREATE INDEX "order_incidents_support_queue_idx" ON "order_incidents" ("support_status","created_at");
--> statement-breakpoint
CREATE TABLE "support_audit" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 "incident_id" uuid NOT NULL REFERENCES "order_incidents"("id"),
 "actor_id" uuid NOT NULL REFERENCES "users"("id"),
 "action" text NOT NULL,
 "note" text,
 "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "support_audit_incident_idx" ON "support_audit" ("incident_id","created_at");
