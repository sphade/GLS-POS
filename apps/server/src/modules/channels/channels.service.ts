/**
 * Delivery-app control centre (Azumi Deliveries), ported from Azumi POS.
 *
 * GLS POS is the source of truth for stock. Each POS product can be linked to
 * an item (or add-on) on Azumi; after any stock change the server works out
 * which linked items should be in or out of stock and pushes only what
 * changed. A failed push leaves the record untouched, so the same change is
 * retried on the next sync.
 *
 * Connection secrets are sealed (AES-GCM) in the store's own Durable Object.
 * Links live there too (server-side), so older app builds can't drop them.
 */
import type { ChannelLink, ChannelLinkView, ChannelStatus, SalesChannel } from "@gls-pos/types";
import { SALES_CHANNELS } from "@gls-pos/types";
import type { Env } from "../../env.js";
import { azumiAdapter, type ItemPush } from "./azumi.adapter.js";
import { openSecret, sealSecret } from "./crypto.js";

type StoredConnection = {
  channel: SalesChannel;
  sealed: string;
  remoteName?: string;
  connectedAt: number;
  lastSyncAt?: number;
  lastError?: string;
};
/** What each Azumi ref was last told: true = in stock. */
type PushedState = Record<string, boolean>;

const stubFor = (env: Env, storeId: string) => env.STORE.get(env.STORE.idFromName(storeId));
type Stub = ReturnType<typeof stubFor>;
type Product = Awaited<ReturnType<Stub["channelProducts"]>>[number];

async function kvGet<T>(stub: Stub, key: string): Promise<T | undefined> {
  const raw = await stub.channelKvGet(key);
  return raw === null ? undefined : (JSON.parse(raw) as T);
}
const kvPut = (stub: Stub, key: string, value: unknown) =>
  stub.channelKvPut(key, value === undefined ? null : JSON.stringify(value));

export const isSalesChannel = (v: string): v is SalesChannel =>
  (SALES_CHANNELS as readonly string[]).includes(v);

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

async function loadConnection(env: Env, stub: Stub, channel: SalesChannel) {
  const conn = await kvGet<StoredConnection>(stub, `conn:${channel}`);
  if (!conn) return null;
  const apiKey = await openSecret(env.BETTER_AUTH_SECRET, conn.sealed);
  return { conn, apiKey };
}

const linksOf = async (stub: Stub, channel: SalesChannel) =>
  (await kvGet<ChannelLink[]>(stub, `links:${channel}`)) ?? [];

/**
 * Delivery apps stop taking orders for an item once GLS stock is at or below
 * this many, so the last few are kept for walk-in customers and a late sync
 * can't oversell. It comes back on Azumi once stock is above it again.
 * Untracked items are always on.
 */
export const DELIVERY_STOCK_CUTOFF = 5;

/** Should a delivery app offer this item right now? */
export function sellable(p: Product): boolean {
  if (p.isActive === false) return false;
  const enough = (stock: number | null | undefined) => stock == null || stock > DELIVERY_STOCK_CUTOFF;
  if (p.variants?.length) return p.variants.some((v) => enough(v.stock));
  return enough(p.stockQuantity);
}

// --- Connect / status -------------------------------------------------------

export async function channelStatuses(env: Env, storeId: string): Promise<ChannelStatus[]> {
  const stub = stubFor(env, storeId);
  return Promise.all(
    SALES_CHANNELS.map(async (channel) => {
      const conn = await kvGet<StoredConnection>(stub, `conn:${channel}`);
      return {
        channel,
        connected: !!conn,
        remoteName: conn?.remoteName,
        connectedAt: conn?.connectedAt,
        lastSyncAt: conn?.lastSyncAt,
        lastError: conn?.lastError,
        linkedCount: (await linksOf(stub, channel)).length,
      };
    }),
  );
}

export async function connectChannel(env: Env, storeId: string, channel: SalesChannel, apiKey: string) {
  const key = apiKey.trim();
  const me = await azumiAdapter(env).me(key); // throws on a bad key
  const stub = stubFor(env, storeId);
  await kvPut(stub, `conn:${channel}`, {
    channel,
    sealed: await sealSecret(env.BETTER_AUTH_SECRET, key),
    remoteName: me.name,
    connectedAt: Date.now(),
  } satisfies StoredConnection);
  // A fresh connection has never been told anything.
  await kvPut(stub, `pushed:${channel}`, undefined);
  return (await channelStatuses(env, storeId)).find((s) => s.channel === channel)!;
}

/** Disconnect. Links are kept, so reconnecting doesn't mean re-linking. */
export async function disconnectChannel(env: Env, storeId: string, channel: SalesChannel) {
  const stub = stubFor(env, storeId);
  await kvPut(stub, `conn:${channel}`, undefined);
  await kvPut(stub, `pushed:${channel}`, undefined);
}

// --- Linking ----------------------------------------------------------------

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Azumi's menu and the current links, for the linking screen. */
export async function channelLinkView(env: Env, storeId: string, channel: SalesChannel): Promise<ChannelLinkView> {
  const stub = stubFor(env, storeId);
  const loaded = await loadConnection(env, stub, channel);
  if (!loaded) throw new Error("Azumi isn't connected");
  return { menu: await azumiAdapter(env).menu(loaded.apiKey), links: await linksOf(stub, channel) };
}

/**
 * Replace the links. One POS product may cover several Azumi entries (an item
 * and the same thing as an add-on); one Azumi entry belongs to one product.
 */
export async function setLinks(env: Env, storeId: string, channel: SalesChannel, links: ChannelLink[]) {
  const stub = stubFor(env, storeId);
  const byRef = new Map<string, ChannelLink>();
  for (const l of links) byRef.set(l.ref, { productId: l.productId, ref: l.ref, kind: l.kind, auto: l.auto });
  await kvPut(stub, `links:${channel}`, [...byRef.values()]);
  return pushAvailability(env, storeId, { force: true });
}

/**
 * Link every Azumi entry whose name matches exactly one POS product (ignoring
 * case and punctuation). Existing links are kept. Returns how many were added.
 */
export async function autoLink(env: Env, storeId: string, channel: SalesChannel) {
  const stub = stubFor(env, storeId);
  const { menu, links } = await channelLinkView(env, storeId, channel);
  const products = await stub.channelProducts();
  const byName = new Map<string, Product[]>();
  for (const p of products) byName.set(norm(p.name), [...(byName.get(norm(p.name)) ?? []), p]);
  const taken = new Set(links.map((l) => l.ref));
  const added: ChannelLink[] = [];
  for (const m of menu) {
    if (taken.has(m.ref)) continue;
    const hits = byName.get(norm(m.name)) ?? [];
    if (hits.length === 1) added.push({ productId: hits[0]!.id, ref: m.ref, kind: m.kind, auto: true });
  }
  if (added.length) await setLinks(env, storeId, channel, [...links, ...added]);
  return { added: added.length, total: links.length + added.length, unmatched: menu.length - links.length - added.length };
}

// --- Availability -----------------------------------------------------------

/**
 * Push what changed to Azumi. `force` re-sends every linked item (Sync now,
 * after linking). Never throws: a sale must never wait on a delivery app.
 */
export async function pushAvailability(
  env: Env,
  storeId: string,
  opts: { force?: boolean } = {},
): Promise<Record<string, { pushed: number; error?: string }>> {
  const report: Record<string, { pushed: number; error?: string }> = {};
  const stub = stubFor(env, storeId);
  for (const channel of SALES_CHANNELS) {
    let loaded: Awaited<ReturnType<typeof loadConnection>> = null;
    try {
      loaded = await loadConnection(env, stub, channel);
      if (!loaded) continue;
      const links = await linksOf(stub, channel);
      if (links.length === 0) {
        report[channel] = { pushed: 0 };
        continue;
      }
      const products = new Map((await stub.channelProducts()).map((p) => [p.id, p]));
      const pushed = (opts.force ? {} : await kvGet<PushedState>(stub, `pushed:${channel}`)) ?? {};
      const next: PushedState = { ...pushed };
      const changes: ItemPush[] = [];
      for (const l of links) {
        const p = products.get(l.productId);
        // A product deleted from the POS is taken off Azumi.
        const inStock = p ? sellable(p) : false;
        if (pushed[l.ref] !== inStock) changes.push({ ref: l.ref, kind: l.kind, inStock });
        next[l.ref] = inStock;
      }
      if (changes.length) await azumiAdapter(env).pushItems(loaded.apiKey, changes);
      await kvPut(stub, `pushed:${channel}`, next);
      if (changes.length || loaded.conn.lastError) {
        await kvPut(stub, `conn:${channel}`, { ...loaded.conn, lastSyncAt: Date.now(), lastError: undefined });
      }
      report[channel] = { pushed: changes.length };
    } catch (e) {
      // `pushed` is untouched, so the same diff is retried next time.
      if (loaded) await kvPut(stub, `conn:${channel}`, { ...loaded.conn, lastError: errorText(e) });
      console.error("[channels] push failed", storeId, channel, errorText(e));
      report[channel] = { pushed: 0, error: errorText(e) };
    }
  }
  return report;
}

/** Run after every till sync. Cheap when nothing stock-related changed. */
export async function afterSync(env: Env, storeId: string, collections: string[]) {
  const touchesStock = collections.some((c) =>
    ["products", "stock_movements", "web_orders", "receipts", "returns"].includes(c),
  );
  if (touchesStock) await pushAvailability(env, storeId);
}
