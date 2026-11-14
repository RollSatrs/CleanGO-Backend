
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
