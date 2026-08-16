import { API_URL, authCookie } from "./auth-client";
import { syncNow } from "./sync";

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

function scheduleReconnect(storeId: string) {
  if (stopped) return;
  attempts += 1;
  const wait = Math.min(1000 * 2 ** (attempts - 1), MAX_BACKOFF_MS);
  retryTimer = setTimeout(() => connect(storeId), wait);
}

function connect(storeId: string) {
  if (stopped) return;

  const cookie = authCookie();
  if (!cookie) {
    // Not signed in yet — try again shortly rather than failing for good.
    scheduleReconnect(storeId);
    return;
  }

  const url = `${API_URL.replace(/^http/, "ws")}/api/realtime`;

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

    socket = new RNWebSocket(url, undefined, {
      headers: { Cookie: cookie, "x-store-id": storeId },
    });
  } catch {
    scheduleReconnect(storeId);
    return;
  }

  socket.onopen = () => {
    attempts = 0;
    // Catch up on anything missed while disconnected.
    void syncNow(storeId);
    pingTimer = setInterval(() => {
      try {
        socket?.send("ping");
      } catch {
        /* the close handler will deal with it */
      }
    }, PING_MS);
  };

  socket.onmessage = (event) => {
    if (event.data === "pong") return;
    // Any change notification simply triggers a sync.
    void syncNow(storeId);
  };

  socket.onerror = () => {
    // onclose always follows; reconnect is handled there.
  };

  socket.onclose = () => {
    clearTimers();
    socket = null;
    scheduleReconnect(storeId);
  };
}

/** Open the realtime channel for a store. Returns a stop function. */
export function startRealtime(storeId: string): () => void {
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
  clearTimers();
  try {
    socket?.close();
  } catch {
    /* ignore */
  }
  socket = null;
}
