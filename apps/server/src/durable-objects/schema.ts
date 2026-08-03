import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import type { OrderChannel, OrderItem, OrderStatus, Payment } from "@gls-pos/types";

/**
 * Per-store operational schema, embedded in each Store Durable Object's SQLite.
 * This is the data plane: one isolated copy of these tables exists per store.
 *
 * Money is integer minor units. Timestamps are ISO strings to map 1:1 onto the
 * shared domain types. Order line items and payments are stored as typed JSON
 * columns for now; hot query paths can be normalised into tables later.
 */

export const products = sqliteTable("products", {
  id: text("id").primaryKey(),
  storeId: text("store_id").notNull(),
  categoryId: text("category_id"),
  name: text("name").notNull(),
  sku: text("sku"),
  barcode: text("barcode"),
  price: integer("price").notNull(),
  cost: integer("cost"),
  currency: text("currency").notNull().default("USD"),
  stockQuantity: integer("stock_quantity"),
  taxRateBps: integer("tax_rate_bps"),
  imageUrl: text("image_url"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(),
  storeId: text("store_id").notNull(),
  channel: text("channel").$type<OrderChannel>().notNull(),
  status: text("status").$type<OrderStatus>().notNull(),
  items: text("items", { mode: "json" }).$type<OrderItem[]>().notNull(),
  payments: text("payments", { mode: "json" }).$type<Payment[]>().notNull(),
  currency: text("currency").notNull(),
  subtotal: integer("subtotal").notNull(),
  taxTotal: integer("tax_total").notNull(),
  discountTotal: integer("discount_total").notNull(),
  grandTotal: integer("grand_total").notNull(),
  customerId: text("customer_id"),
  staffId: text("staff_id"),
  note: text("note"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
