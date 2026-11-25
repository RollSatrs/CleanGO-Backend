
import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  bigint,
  uniqueIndex,
  index,
  numeric,
  boolean,
} from "drizzle-orm/pg-core";

// ==========================================
// USERS
// ==========================================

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    telegramId: bigint("telegram_id", {
      mode: "bigint",
    }),

    phone: text("phone"),
    phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true }),

    firstName: text("first_name"),
    lastName: text("last_name"),

    role: text("role")
      .notNull()
      .default("unselected"),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("users_telegram_id_idx").on(
      table.telegramId,
    ),
    uniqueIndex("users_phone_idx").on(
      table.phone,
    ),
  ],
);

export const userAvatars = pgTable("user_avatars", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  image: text("image").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ==========================================
// ORDERS
// ==========================================

export const orders = pgTable("orders", {
  id: uuid("id").defaultRandom().primaryKey(),

  userId: uuid("user_id").references(
    () => users.id,
  ),

  address: text("address").notNull(),

  area: integer("area").notNull(),

  cleaningType: text("cleaning_type")
    .notNull()
    .default("regular"),

  price: integer("price"),

  cleanerId: uuid("cleaner_id").references(() => users.id),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  travelMode: text("travel_mode"),
  etaMinutes: integer("eta_minutes"),
  etaCalculatedAt: timestamp("eta_calculated_at", { withTimezone: true }),
  inspectionMethod: text("inspection_method").notNull().default("photos"),
  completionPhotos: text("completion_photos").array(),
  completionSubmittedAt: timestamp("completion_submitted_at", { withTimezone: true }),
  completionReminderAt: timestamp("completion_reminder_at", { withTimezone: true }),
  completionEscalatedAt: timestamp("completion_escalated_at", { withTimezone: true }),
  clientConfirmedAt: timestamp("client_confirmed_at", { withTimezone: true }),
  completionIssueAt: timestamp("completion_issue_at", { withTimezone: true }),
  rating: numeric("rating", { precision: 2, scale: 1, mode: "number" }),
  reviewText: text("review_text"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewVisibility: text("review_visibility").notNull().default("published"),

  latitude: numeric("latitude", { precision: 9, scale: 6 }),
  longitude: numeric("longitude", { precision: 9, scale: 6 }),
  apartment: text("apartment"),
  entrance: text("entrance"),
  floor: text("floor"),
  addressComment: text("address_comment"),
  areaHint: text("area_hint"),
  matchingStartedAt: timestamp("matching_started_at", { withTimezone: true }),
  matchingRound: integer("matching_round").notNull().default(0),

  status: text("status")
    .notNull()
    .default("pending"),

  createdAt: timestamp("created_at", {
    withTimezone: true,
  })
    .defaultNow()
    .notNull(),
});


// ==========================================
// CLEANER PROFILES — opt-in availability and service area
// ==========================================
export const cleanerProfiles = pgTable("cleaner_profiles", {
  userId: uuid("user_id").primaryKey().references(() => users.id),
  isAvailable: boolean("is_available").notNull().default(false),
  availableUntil: timestamp("available_until", { withTimezone: true }),
  serviceRadiusKm: integer("service_radius_km"),
  serviceArea: text("service_area"),
  serviceTypes: text("service_types").array(),
  latitude: numeric("latitude", { precision: 9, scale: 6 }),
  longitude: numeric("longitude", { precision: 9, scale: 6 }),
  lastLocationAt: timestamp("last_location_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ==========================================
// ORDER OFFERS — multiple simultaneous private proposals
// ==========================================
export const orderOffers = pgTable("order_offers", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id").notNull().references(() => orders.id),
  cleanerId: uuid("cleaner_id").notNull().references(() => users.id),
  batchNumber: integer("batch_number").notNull(),
  status: text("status").notNull().default("offered"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("order_offers_order_cleaner_uidx").on(table.orderId, table.cleanerId),
  index("order_offers_cleaner_status_expiry_idx").on(table.cleanerId, table.status, table.expiresAt),
  index("order_offers_order_status_idx").on(table.orderId, table.status),
]);

// ==========================================
// ORDER EVENTS — audit log; payload must never expose private address
// ==========================================
export const orderEvents = pgTable("order_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id").notNull().references(() => orders.id),
  actorId: uuid("actor_id").references(() => users.id),
  eventType: text("event_type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("order_events_order_created_idx").on(table.orderId, table.createdAt),
]);

export const orderIncidents=pgTable("order_incidents",{
 id:uuid("id").defaultRandom().primaryKey(),
 orderId:uuid("order_id").notNull().references(()=>orders.id),
 actorId:uuid("actor_id").notNull().references(()=>users.id),
 actorRole:text("actor_role").notNull(),
 cleanerId:uuid("cleaner_id").references(()=>users.id),
 kind:text("kind").notNull(),
 reason:text("reason").notNull(),
 comment:text("comment"),
 photos:text("photos").array(),
 previousStatus:text("previous_status").notNull(),
 supportStatus:text("support_status"),
 supportAssignedTo:uuid("support_assigned_to").references(()=>users.id),
 supportResponse:text("support_response"),
 supportResolvedAt:timestamp("support_resolved_at",{withTimezone:true}),
 supportUpdatedAt:timestamp("support_updated_at",{withTimezone:true}),
 createdAt:timestamp("created_at",{withTimezone:true}).defaultNow().notNull(),
},t=>[index("order_incidents_order_created_idx").on(t.orderId,t.createdAt),index("order_incidents_cleaner_kind_idx").on(t.cleanerId,t.kind)]);

export const supportAudit=pgTable("support_audit",{
 id:uuid("id").defaultRandom().primaryKey(),incidentId:uuid("incident_id").notNull().references(()=>orderIncidents.id),actorId:uuid("actor_id").notNull().references(()=>users.id),action:text("action").notNull(),note:text("note"),createdAt:timestamp("created_at",{withTimezone:true}).defaultNow().notNull(),
},t=>[index("support_audit_incident_idx").on(t.incidentId,t.createdAt)]);
