import { menu, type MenuItem } from './menu';

const byId = new Map<string, MenuItem>(menu.flatMap((c) => c.items).map((i) => [i.id, i]));

/** Client-side order bag. Totals are integer kobo; the POS remains authoritative on price. */
class OrderBag {
  lines = $state<Record<string, number>>({});
  open = $state(false);
  /** Active menu category — other chapters can deep-link into it. */
  tab = $state(menu[0]!.id);

  get items() {
    return Object.entries(this.lines)
      .filter(([, q]) => q > 0)
      .map(([id, qty]) => ({ item: byId.get(id)!, qty }))
      .filter((l) => l.item);
  }
  get count() {
    return this.items.reduce((n, l) => n + l.qty, 0);
  }
  get totalMinor() {
    return this.items.reduce((n, l) => n + l.item.priceMinor * l.qty, 0);
  }
  qty(id: string) {
    return this.lines[id] ?? 0;
  }
  add(id: string) {
    this.lines[id] = this.qty(id) + 1;
  }
  remove(id: string) {
    const q = this.qty(id) - 1;
    if (q <= 0) delete this.lines[id];
    else this.lines[id] = q;
  }
  clear() {
    this.lines = {};
  }
}

export const bag = new OrderBag();
