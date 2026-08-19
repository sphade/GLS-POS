import type { ApiEvent, ApiEventType, StockEventData } from "@gls-pos/types";
import type { StockTransition } from "../../durable-objects/store.do.js";

/**
 * Translate stock changes into the public event vocabulary.
 *
 * Emits both a generic `stock.changed` (for integrators that just want to mirror
 * levels) and a specific threshold event when the *state* crossed a boundary —
 * that's what a delivery app needs in order to hide or re-list an item.
 */
export function stockEvents(
  storeId: string,
  transitions: StockTransition[],
  startSeq = Date.now(),
): ApiEvent<StockEventData>[] {
  const events: ApiEvent<StockEventData>[] = [];
  let seq = startSeq;

  for (const t of transitions) {
    const data: StockEventData = {
      productId: t.productId,
      name: t.name,
      stock: t.stock,
      previousStock: t.previousStock,
      lowStockAt: t.lowStockAt,
      stockState: t.stockState,
    };

    const push = (type: ApiEventType) =>
      events.push({ seq: ++seq, type, occurredAt: Date.now(), storeId, data });

    push("stock.changed");

    const wasOut = (t.previousStock ?? 0) <= 0;
    const isOut = (t.stock ?? 0) <= 0;
    const threshold = t.lowStockAt ?? 3;
    const wasLow = !wasOut && (t.previousStock ?? 0) <= threshold;
    const isLow = !isOut && (t.stock ?? 0) <= threshold;

    // Only fire threshold events on an actual crossing, so integrators don't
    // get "stock.low" repeatedly while an item sits at 2.
    if (isOut && !wasOut) push("stock.out");
    else if (wasOut && !isOut) push("stock.replenished");
    else if (isLow && !wasLow) push("stock.low");
  }

  return events;
}
