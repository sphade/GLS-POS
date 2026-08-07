# Information Architecture — GLS-POS

The map of the app. Consult this before building a screen, so we reuse instead of
rebuild. Visual language is the Zobaze/Restokeep style already established
(primary-blue-now-GLS-green bars, white cards on `#E0E0E0`, caps section titles).

## The core idea: entities, not screens

Screens that look similar usually render the **same entity through a different
lens**. That is expected. Build the data + components once, compose screens on top.

For each entity we need at most three reusable pieces:

| Piece | Purpose |
| --- | --- |
| **List** | browse/scan many (sale mode = tap to add, manage mode = tap to edit) |
| **Editor** | create/update one |
| **Picker** | choose one from inside another editor |

## Entities

Product · Category · Modifier (group + options) · Ingredient · Table (+ Section) ·
Order/Receipt · Payment · Customer · Staff · Expense/Income · Store

## Screen → component map

Anything sharing a row is the **same component in a different mode**.

| Screen | Composed of |
| --- | --- |
| Items tab | Product list *(sale mode, grid)* |
| Take Order | Product list *(sale mode, rows, by category)* |
| Inventory ▸ Items | Product list *(manage mode)* → Product editor |
| Inventory ▸ Categories | Category list → Category editor |
| Inventory ▸ Modifiers | Modifier list → Modifier editor |
| Inventory ▸ Ingredients | Ingredient list → Ingredient editor |
| Item editor ▸ Category field | Category **picker** |
| Item editor ▸ Modifiers field | Modifier **picker** |
| Select Table | Table list *(sale mode)* |
| Table Management | Table list *(manage mode)* → Table editor |
| Customers | Customer list → Customer editor |
| Staff | Staff list → Staff editor |
| Expenses | Category grid → Amount entry |

**Rule:** the "Add Item" screen reached from the Items tab and from Inventory ▸
Items is *one* file. Never duplicate an editor.

## Shared UI components

- `PosHeader` / `PosSearchBar` — the primary app bar (store switcher or title) + search row
- `PosTabBar` — 5-tab bottom nav, active tab filled edge-to-edge
- `EntityListScreen` — toolbar + search + rows + FAB, used by every manage-mode list
- `EmptyState` — mascot + message
- `BarChart` — report drill-down chart
- `SwipeTabs` — tappable + swipeable tab pager (reports, take-order, inventory hub)
- `FormCard` / `FieldRow` / `ToggleRow` / `FeatureCard` — editor building blocks

## Build phases

1. **Sell & get paid** — catalog, cart, tables, charge, cash, receipt ✅
2. **Manage the catalog** — Inventory hub: Items · Categories · Modifiers · Ingredients
3. **Run the business** — reports, expenses, customers, staff & roles
4. **Restaurant-specific** — KOT, KDS, floor plan, printing

## Explicitly out of scope

Subscriptions/entitlements/paywalls, SMS credits, franchise & reseller,
public storefront, Intercom support chat, ZCar, multi-country tax regimes.
This is for our own restaurants — every feature is available, no plan gating.
