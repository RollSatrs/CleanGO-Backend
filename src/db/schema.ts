
import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  bigint,
  uniqueIndex,
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

  status: text("status")
    .notNull()
    .default("pending"),

  createdAt: timestamp("created_at", {
    withTimezone: true,
  })
    .defaultNow()
    .notNull(),
});
