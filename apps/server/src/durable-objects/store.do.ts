/// <reference types="@cloudflare/workers-types" />
import { DurableObject } from "cloudflare:workers";
import { drizzle, type DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { desc, eq } from "drizzle-orm";
import type { Order, OrderItem, Payment, Product } from "@gls-pos/types";
import type { Env } from "../env.js";
import { newId } from "../lib/id.js";
import type { CreateProductInput, UpdateProductInput } from "../modules/products/products.schema.js";
import type { CreateOrderInput } from "../modules/orders/orders.schema.js";
import * as schema from "./schema.js";
import migrations from "./migrations/migrations.js";

type ProductRow = typeof schema.products.$inferSelect;
type OrderRow = typeof schema.orders.$inferSelect;

/** Map a nullable DB row to the shared domain type (null → undefined). */
function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    storeId: row.storeId,
    categoryId: row.categoryId ?? undefined,
    name: row.name,
    sku: row.sku ?? undefined,
    barcode: row.barcode ?? undefined,
    price: row.price,
    cost: row.cost ?? undefined,
    currency: row.currency,
    stockQuantity: row.stockQuantity,
    taxRateBps: row.taxRateBps ?? undefined,
    imageUrl: row.imageUrl ?? undefined,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toOrder(row: OrderRow): Order {
  return {
    id: row.id,
    storeId: row.storeId,
    channel: row.channel,
    status: row.status,
    items: row.items,
    payments: row.payments,
    currency: row.currency,
    subtotal: row.subtotal,
    taxTotal: row.taxTotal,
    discountTotal: row.discountTotal,
    grandTotal: row.grandTotal,
    customerId: row.customerId ?? undefined,
    staffId: row.staffId ?? undefined,
    note: row.note ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * One Durable Object per store. Owns that store's live operational data
 * (catalog, orders, and later inventory/tables/KOT) in embedded SQLite,
 * accessed through Drizzle's `durable-sqlite` driver.
 *
 * Single-threaded execution makes POS operations here race-free without
 * explicit locking. Migrations run once at startup inside blockConcurrencyWhile
 * so queries never hit an unmigrated database.
 *
 * Exposes typed RPC methods called by the Worker's route modules.
 */
export class StoreDurableObject extends DurableObject<Env> {
  private readonly db: DrizzleSqliteDODatabase<typeof schema>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.db = drizzle(ctx.storage, { schema, logger: false });
    ctx.blockConcurrencyWhile(async () => {
      await migrate(this.db, migrations);
    });
  }

  // --- Products -------------------------------------------------------------

  async listProducts(): Promise<Product[]> {
    const rows = await this.db
      .select()
      .from(schema.products)
      .orderBy(desc(schema.products.createdAt));
    return rows.map(toProduct);
  }

  async getProduct(id: string): Promise<Product | null> {
    const [row] = await this.db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, id))
      .limit(1);
    return row ? toProduct(row) : null;
  }

  async createProduct(input: CreateProductInput): Promise<Product> {
    const now = new Date().toISOString();
    const product: Product = { id: newId("prod"), ...input, createdAt: now, updatedAt: now };
    await this.db.insert(schema.products).values(product);
    return product;
  }

  async updateProduct(id: string, input: UpdateProductInput): Promise<Product | null> {
    const existing = await this.getProduct(id);
    if (!existing) return null;
    const updated: Product = {
      ...existing,
      ...input,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    await this.db.update(schema.products).set(updated).where(eq(schema.products.id, id));
    return updated;
  }

  async deleteProduct(id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(schema.products)
      .where(eq(schema.products.id, id))
      .returning({ id: schema.products.id });
    return deleted.length > 0;
  }

  // --- Orders ---------------------------------------------------------------

  async listOrders(): Promise<Order[]> {
    const rows = await this.db.select().from(schema.orders).orderBy(desc(schema.orders.createdAt));
    return rows.map(toOrder);
  }

  async getOrder(id: string): Promise<Order | null> {
    const [row] = await this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, id))
      .limit(1);
    return row ? toOrder(row) : null;
  }

  /** Totals are computed here so the client can never dictate the final price. */
  async createOrder(input: CreateOrderInput): Promise<Order> {
    const timestamp = new Date().toISOString();

    const items: OrderItem[] = input.items.map((item) => ({
      id: newId("item"),
      productId: item.productId,
      name: item.name,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      taxRateBps: item.taxRateBps,
      lineTotal: item.unitPrice * item.quantity,
    }));

    const payments: Payment[] = input.payments.map((payment) => ({
      id: newId("pay"),
      method: payment.method,
      amount: payment.amount,
      reference: payment.reference,
      createdAt: timestamp,
    }));

    const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
    const taxTotal = items.reduce(
      (sum, item) => sum + Math.round((item.lineTotal * (item.taxRateBps ?? 0)) / 10000),
      0,
    );
    const grandTotal = subtotal + taxTotal - input.discountTotal;

    const order: Order = {
      id: newId("order"),
      storeId: input.storeId,
      channel: input.channel,
      status: input.status,
      items,
      payments,
      currency: input.currency,
      subtotal,
      taxTotal,
      discountTotal: input.discountTotal,
      grandTotal,
      customerId: input.customerId,
      staffId: input.staffId,
      note: input.note,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await this.db.insert(schema.orders).values(order);
    return order;
  }
}
