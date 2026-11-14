
import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";

export const orders = pgTable("orders", {
  id: uuid("id").defaultRandom().primaryKey(),

  address: text("address").notNull(),

  area: integer("area").notNull(),

  cleaningType: text("cleaning_type")
    .notNull()
    .default("regular"),

  // Стоимость уборки в тенге
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

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  telegramId: text("telegram_id").notNull().unique(),
  phone: text("phone"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  role: text("role").notNull().default("unselected"),
  cleanerStatus: text("cleaner_status").notNull().default("not_applied"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
