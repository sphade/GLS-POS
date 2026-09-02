import { API_URL, authCookie } from "./auth-client";
import { SYNC_ENABLED, syncNow } from "./sync";

/**
 * Realtime nudges from the store's Durable Object.
 *
 * The socket carries no data — when the server says "something changed" we run
 * a normal sync. That keeps one code path for applying data, so a dropped
 * message is harmless (the 20s poll is still there as a safety net) and the
 * offline-first guarantees are unchanged.
 *
 * Reconnects with capped exponential backoff and pings every 25s to survive
 * idle-connection timeouts on mobile networks.
 */

const PING_MS = 25_000;
const MAX_BACKOFF_MS = 30_000;

let socket: WebSocket | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let attempts = 0;
let stopped = false;
let currentStore: string | null = null;
let generation = 0;

/**
 * Every connection attempt is stamped with a generation.
 *
 * A socket that gets replaced — by a shop switch or a reconnect — still fires
 * its handlers asynchronously afterwards, and those handlers close over the
 * *old* store id. Without this stamp the replaced socket's `close` event ran
 * against the new state: it reconnected for the shop the user had just left and
 * synced that shop's products, tables and VIP orders into the newly opened
 * shop's database. Stamping lets a superseded connection recognise itself and
 * do nothing.
 */
const isCurrent = (gen: number) => gen === generation && !stopped;

function clearTimers() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function scheduleReconnect(storeId: string, gen: number) {
  if (!isCurrent(gen)) return;
  attempts += 1;
  const wait = Math.min(1000 * 2 ** (attempts - 1), MAX_BACKOFF_MS);
  retryTimer = setTimeout(() => {
    if (!isCurrent(gen)) return;
    connect(storeId);
  }, wait);
}

function connect(storeId: string) {
  if (stopped) return;

  const gen = ++generation;

  const cookie = authCookie();
  if (!cookie) {
    // Not signed in yet — try again shortly rather than failing for good.
    scheduleReconnect(storeId, gen);
    return;
  }

  const url = `${API_URL.replace(/^http/, "ws")}/api/realtime`;

  // Handlers hold their own reference rather than reading the module variable,
  // so a late event from this socket can never null out or de-timer whichever
  // socket happens to be live by then.
  let ws: WebSocket;
  try {
    // React Native's WebSocket accepts headers, which is how we pass the
    // better-auth cookie and the store scope (browsers can't do this).
    // The RN runtime supports a third `options` argument with headers, which
    // the DOM typings don't describe — hence the cast.
    const RNWebSocket = WebSocket as unknown as new (
      url: string,
      protocols: string | string[] | undefined,
      options: { headers: Record<string, string> },
    ) => WebSocket;

    ws = new RNWebSocket(url, undefined, {
      headers: { Cookie: cookie, "x-store-id": storeId },
    });
  } catch {
    scheduleReconnect(storeId, gen);
    return;
  }
  socket = ws;

  ws.onopen = () => {
    if (!isCurrent(gen)) {
      // Superseded while the handshake was in flight. Hang up quietly — syncing
      // here would be a sync for the shop the user just left.
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      return;
    }
    attempts = 0;
    // Catch up on anything missed while disconnected.
    void syncNow(storeId);
    pingTimer = setInterval(() => {
      if (!isCurrent(gen)) return;
      try {
        ws.send("ping");
      } catch {
        /* the close handler will deal with it */
      }
    }, PING_MS);
  };

  ws.onmessage = (event) => {
    if (!isCurrent(gen)) return;
    if (event.data === "pong") return;
    // Any change notification simply triggers a sync.
    void syncNow(storeId);
  };

  ws.onerror = () => {
    // onclose always follows; reconnect is handled there.
  };

  ws.onclose = () => {
    if (!isCurrent(gen)) return;
    clearTimers();
    socket = null;
    scheduleReconnect(storeId, gen);
  };
}

/** Open the realtime channel for a store. Returns a stop function. */
export function startRealtime(storeId: string): () => void {
  if (!SYNC_ENABLED) {
    stopRealtime();
    return () => {};
  }

  // Restarting for the same store is a no-op so screen re-renders don't churn.
  if (currentStore === storeId && socket) return () => stopRealtime();

  stopRealtime();
  stopped = false;
  attempts = 0;
  currentStore = storeId;
  connect(storeId);
  return () => stopRealtime();
}

export function stopRealtime(): void {
  stopped = true;
  currentStore = null;
  // Retire every outstanding handler BEFORE closing. startRealtime sets
  // `stopped` back to false immediately, so the close event this triggers
  // arrives once the channel looks open again — the generation is what stops it
  // reconnecting to the shop we're leaving.
  generation += 1;
  clearTimers();
  const closing = socket;
  socket = null;
  try {
    closing?.close();
  } catch {
    /* ignore */
  }
}
