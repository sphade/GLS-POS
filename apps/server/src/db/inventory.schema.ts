import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

/**
 * Global inventory schema for centralized distribution management.
 * 
 * This enables:
 * - Tracking bulk stock across all stores (e.g., 50kg rice)
 * - Recording allocations (e.g., 20kg to GLS1, 30kg to GLS2)
 * - Conversion rates per store (e.g., GLS1: 250g per portion)
 */

// --- Global inventory items (bulk stock) ---

/**
 * A bulk inventory item that can be distributed across stores.
 * Example: "Rice - 50kg bag", "Turkey - whole", "Oil - 5L container"
 */
export const globalInventoryItems = sqliteTable("global_inventory_items", {
  id: text("id").primaryKey(), // e.g., 'rice-50kg-bag-001'
  name: text("name").notNull(), // e.g., 'Rice - 50kg bag'
  unit: text("unit").notNull(), // 'kg', 'liters', 'pieces', 'bags'
  totalStock: integer("total_stock").notNull().default(0), // Total quantity in base units
  minStock: integer("min_stock").notNull().default(0), // Alert threshold
  description: text("description"), // Optional notes
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// --- Inventory allocations (distribution tracking) ---

/**
 * Records when stock is allocated FROM one store (usually central warehouse)
 * TO another store (branch).
 */
export const inventoryAllocations = sqliteTable("inventory_allocations", {
  id: text("id").primaryKey(), // e.g., 'alloc_001'
  globalItemId: text("global_item_id")
    .notNull()
    .references(() => globalInventoryItems.id),
  fromStoreId: text("from_store_id") // The source (warehouse)
    .notNull(),
  toStoreId: text("to_store_id") // The destination (branch)
    .notNull(),
  /**
   * Destination product in the receiving store whose DO stock is raised on
   * fulfill. Nullable so rows created before the picker existed stay valid;
   * when null the server matches by global-item name instead.
   */
  productId: text("product_id"),
  quantity: integer("quantity").notNull(), // Amount allocated
  status: text("status", { 
    enum: ["pending", "fulfilled", "cancelled"] 
  }).notNull().default("pending"),
  allocatedAt: integer("allocated_at", { mode: "timestamp" }).notNull(),
  fulfilledAt: integer("fulfilled_at", { mode: "timestamp" }), // When received
  notes: text("notes"), // Optional: reason, order reference, etc.
  /**
   * Audit trail: who sent / confirmed each movement. Nullable so the existing
   * staging rows (written before attribution existed) stay valid.
   */
  allocatedByUserId: text("allocated_by_user_id"),
  allocatedByName: text("allocated_by_name"),
  fulfilledByUserId: text("fulfilled_by_user_id"),
  fulfilledByName: text("fulfilled_by_name"),
});

// --- Store-level conversion rates (bulk → portion) ---

/**
 * Each store may convert bulk stock into menu items differently.
 * Example: GLS1 sells rice in 250g spoons, GLS2 sells in 200g bowls.
 */
export const inventoryConversionRates = sqliteTable("inventory_conversion_rates", {
  id: text("id").primaryKey(),
  storeId: text("store_id")
    .notNull(),
  globalItemId: text("global_item_id")
    .notNull()
    .references(() => globalInventoryItems.id),
  // How the store uses this item in their menu
  portionName: text("portion_name").notNull(), // e.g., 'Jollof Rice - Per Spoon'
  quantityPerPortion: real("quantity_per_portion").notNull(), // e.g., 0.25 (kg per portion)
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// --- Migration: inventory conversion (for existing stock) ---

/**
 * Tracks how much of a global item has been converted to menu portions
 * for a specific store. Used to know how many menu items are available.
 */
export const inventoryConversions = sqliteTable("inventory_conversions", {
  id: text("id").primaryKey(),
  storeId: text("store_id")
    .notNull(),
  globalItemId: text("global_item_id")
    .notNull()
    .references(() => globalInventoryItems.id),
  // How much has been converted
  bulkQuantityUsed: integer("bulk_quantity_used").notNull(), // e.g., 20000 (grams from 20kg)
  portionsProduced: integer("portions_produced").notNull(), // e.g., 80 portions
  convertedAt: integer("converted_at", { mode: "timestamp" }).notNull(),
  notes: text("notes"), // Optional: batch reference
});
