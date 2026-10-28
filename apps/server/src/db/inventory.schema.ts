import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";

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
 * A bulk inventory item owned by the central store.
 * Example: "Rice", 100 bags; "Turkey", 20 pieces; "Oil", 30 litres.
 *
 * The central store is a real store row (`store.is_central`), so its stock is
 * not shared with other owners. `storeId` is the central store that owns this
 * item; `ownerId` scopes it even for legacy rows created before the central
 * store existed.
 */
export const globalInventoryItems = sqliteTable("global_inventory_items", {
  id: text("id").primaryKey(), // e.g., 'inv_...'
  ownerId: text("owner_id"),
  storeId: text("store_id"),
  name: text("name").notNull(), // e.g., 'Rice'
  unit: text("unit").notNull(), // 'kg', 'liters', 'pieces', 'bags'
  totalStock: integer("total_stock").notNull().default(0), // Total quantity in base units
  minStock: integer("min_stock").notNull().default(0), // Alert threshold
  description: text("description"), // Optional notes
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  index("global_inventory_items_store_idx").on(table.storeId),
]);

// --- Central stock movements (add / remove ledger) ---

/**
 * One add or remove on a central item.
 *
 * Menu products keep their history in the store's own `stock_movements` log;
 * central items live in D1, so they need their own ledger. Every adjustment is
 * stored with the balance before and after, who did it and why, so the owner
 * can see how a 5 kg item became 80 kg without guessing.
 */
export const centralStockMovements = sqliteTable("central_stock_movements", {
  id: text("id").primaryKey(),
  itemId: text("item_id")
    .notNull()
    .references(() => globalInventoryItems.id),
  /** Central store that owns the item. */
  storeId: text("store_id"),
  /** Signed change: +50 for a delivery, -20 for a transfer or spoilage. */
  delta: integer("delta").notNull(),
  /** Balance before this change. */
  baseStock: integer("base_stock").notNull(),
  /** Balance after this change. */
  resulting: integer("resulting").notNull(),
  note: text("note"),
  actorId: text("actor_id"),
  actorName: text("actor_name"),
  at: integer("at", { mode: "timestamp" }).notNull(),
}, (table) => [
  index("central_stock_movements_item_idx").on(table.itemId, table.at),
]);

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
   * Legacy destination product mapping. New transfers never set this: a
   * delivery is recorded against the central item itself, so the shop does not
   * need a matching menu product.
   */
  productId: text("product_id"),
  /** Quantity that leaves the centre, in the central item's unit (e.g. 1 kg). */
  quantity: integer("quantity").notNull(), // Amount allocated
  /**
   * Quantity the receiving shop records as received, in the same unit as
   * `quantity`. Kept as a separate column for rows written before transfers
   * stopped converting units; new rows always mirror `quantity`.
   */
  receiveQuantity: integer("receive_quantity"),
  /** The item's unit at the time of the transfer, for display: 'kg', 'pieces', ... */
  receiveUnit: text("receive_unit"),
  status: text("status", { 
    enum: ["pending", "fulfilled", "cancelled"] 
  }).notNull().default("pending"),
  allocatedAt: integer("allocated_at", { mode: "timestamp" }).notNull(),
  /**
   * When the central stock was actually deducted. New transfers deduct on
   * dispatch, so this is set at send time. Rows from before the tree model
   * have null here and are deducted on receipt instead.
   */
  stockDeductedAt: integer("stock_deducted_at", { mode: "timestamp" }),
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
}, (table) => [
  index("inventory_allocations_from_store_idx").on(table.fromStoreId),
]);

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
  /**
   * The branch menu product this rate produces (e.g. "Jollof rice"). Nullable
   * only for rows written before conversions targeted a real product; new
   * rates always name one, because converting stock must raise something.
   */
  productId: text("product_id"),
  // How the store uses this item in their menu
  portionName: text("portion_name").notNull(), // e.g., 'Jollof Rice - Per Spoon'
  quantityPerPortion: real("quantity_per_portion").notNull(), // e.g., 0.25 (kg per portion)
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  uniqueIndex("inventory_conversion_rates_target_idx").on(
    table.storeId,
    table.globalItemId,
    table.productId,
  ),
]);

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
  /**
   * The menu product this batch was turned into. Nullable only for historical
   * rows; every new conversion raises exactly one product's stock.
   */
  productId: text("product_id"),
  // How much has been converted
  bulkQuantityUsed: integer("bulk_quantity_used").notNull(), // e.g., 20000 (grams from 20kg)
  portionsProduced: integer("portions_produced").notNull(), // e.g., 80 portions
  convertedAt: integer("converted_at", { mode: "timestamp" }).notNull(),
  notes: text("notes"), // Optional: batch reference
});

// --- Production rules (branch product -> branch product) ---

/**
 * An owner-defined yield rule between two products in the same store's
 * catalog: `inputQty` units of the input are used up to make `outputQty` units
 * of the output. Example: 1 bag of rice -> 5 plates of jollof rice.
 *
 * The rule is a *default* for the production screen, not a hard constraint:
 * the person running the batch records what they actually used and made, so
 * real yield can drift from the recipe and be calibrated later. Stock itself
 * lives in the store Durable Object; this table only stores the recipe.
 */
export const inventoryProductionRules = sqliteTable(
  "inventory_production_rules",
  {
    id: text("id").primaryKey(),
    storeId: text("store_id").notNull(),
    inputProductId: text("input_product_id").notNull(),
    outputProductId: text("output_product_id").notNull(),
    inputQty: integer("input_qty").notNull(),
    outputQty: integer("output_qty").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("inventory_production_rules_store_idx").on(table.storeId),
    // One rule per pair per store; saving the same pair updates its numbers.
    uniqueIndex("inventory_production_rules_pair_idx").on(
      table.storeId,
      table.inputProductId,
      table.outputProductId,
    ),
  ],
);
