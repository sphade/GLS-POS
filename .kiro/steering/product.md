# Product — GLS-POS

GLS-POS is a mobile-first point of sale for restaurants, cafés, bars, and food
trucks, modeled on the **Zobaze / Restokeep** POS experience. It's built for the
owner's own restaurants first, so there are no plan tiers or item caps — every
feature is available.

## Guiding principles

- **The POS is the single source of truth** for the menu, inventory, and every
  sale. Sales from any channel — dine-in, takeaway, phone, delivery, online —
  become channel-agnostic `Order`s against one catalog.
- **Offline-first.** A dropped signal never stops a sale. The app takes orders,
  bills, and prints receipts from locally cached data, then syncs when
  connectivity returns. Completed sales are never silently lost.
- **Server-authoritative money.** Totals, taxes, and discounts are recomputed
  server-side; the client never dictates final price.
- **Integer minor units.** All money is stored as integer minor units (e.g.
  cents) to avoid floating-point errors.
- **One codebase, three platforms.** iOS, Android, and web via Expo.
- **Fast where it counts.** Browsing the menu and adding to the cart feel
  instant, with no network round-trip required.
- **Auditable.** Refunds, discounts, and stock adjustments are attributable to a
  staff member and timestamped.

## Feature areas

Modeled on the Zobaze restaurant POS. These describe the intended product; not
all are built yet.

- **Menu & catalog** — categories, items, variations (S/M/L), modifier groups
  (add-ons), images, SKU/barcode, active/inactive. Items can be sold without
  stock tracking ("sell without stock").
- **Inventory & ingredients** — stock tracking with low-stock alerts,
  ingredient/recipe-based deduction, stock movements (received, adjustment,
  waste, sale). Overselling is warned, and optionally blocked per item.
- **Cart & order taking** — build orders with quantities, variations, modifiers,
  line and order notes. Order types: dine-in, takeaway, delivery, online.
  Percentage or fixed discounts at line and order level; optional service charge.
- **Tables & floor** — floor sections and tables with capacity; open running
  tickets per table, add items over time, transfer or merge tickets, free the
  table on payment; table status and running total at a glance.
- **Kitchen (KOT & KDS)** — generate Kitchen Order Tickets on send-to-kitchen,
  route items to stations (e.g. bar vs. hot kitchen), live Kitchen Display with
  elapsed time and item/ticket status, follow-on KOTs for added items, reprint.
- **Billing, payments & receipts** — multiple payment methods (cash, card,
  wallet, transfer, other), change due, split bill (by amount, guests, or
  items), full/partial refunds that restore stock, receipts printed or shared
  (text/PDF/link) with store details, itemization, taxes, discounts, totals.
- **Staff, roles & permissions** — owner, manager, cashier, waiter/captain,
  kitchen/chef. PIN or credential sign-in; sensitive actions (refunds, large
  discounts, price edits, reports, settings) gated by role; sales attributed to
  staff; deactivation preserves history.
- **Customers (CRM)** — name plus optional phone/email/address, attach to
  orders, lookup by name/phone, order history and total spend.
- **Reports & analytics** — total sales and order count by date range, gross
  profit (sales minus COGS) where cost is known, breakdowns by payment method /
  channel / category, top-selling items, sales by staff.
- **Expenses** — record amount, category, note, date; folded into profit;
  grouped by category.
- **Multi-channel orders** — every order carries its channel; delivery and
  online orders create against the same catalog and advance through
  fulfillment states (received, preparing, ready, out for delivery, delivered).
- **Store setup & settings** — store name/address/contact, currency, receipt
  header/footer, tax rates (inclusive or exclusive), service charge, rounding;
  multi-store scoping of catalog, inventory, staff, and orders.

## Out of scope (for now)

Public online storefront, loyalty programs, payment-processor hardware
integrations, and multi-currency conversion (one currency per store).

## Terminology

- **KOT** — Kitchen Order Ticket, the itemized ticket sent to the kitchen.
- **KDS** — Kitchen Display System, the screen showing live tickets to kitchen staff.
- **Menu item** — a sellable product; may have variations and modifiers.
- **Modifier** — an add-on/option (e.g. "extra cheese", "no onions").
- **Ticket** — a running dine-in order tied to a table until billed.
