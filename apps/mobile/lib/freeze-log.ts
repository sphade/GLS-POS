import { AppState } from "react-native";
import { deviceMeta } from "./db";
import { getSyncActivity } from "./sync";

/**
 * Records freezes and unexpected restarts on this device, so a till that
 * "hangs for no reason" leaves evidence in Diagnostics instead of a guess.
 *
 *  - Freeze: a one-second heartbeat that fires late means the JavaScript
 *    thread was blocked. Gaps over FREEZE_MS are logged with what the app was
 *    doing (syncing or not).
 *  - Unexpected restart: a heartbeat time is saved every few seconds while the
 *    app is open. If the app starts again and the last session never went to
 *    the background, Android killed it (out of memory) or it crashed: that is
 *    the "screen goes black, then it comes back" case.
 *
 * Everything is kept in the device database, capped at the newest 30 entries.
 */

export type FreezeEntry = {
  at: number;
  kind: "freeze" | "restart";
  /** How long the thread was blocked (freeze) or the app was gone (restart). */
  ms: number;
  syncing?: boolean;
};

const LOG_KEY = "freeze_log_v1";
const ALIVE_KEY = "freeze_alive_v1";
const TICK_MS = 1000;
const FREEZE_MS = 2000;
const MAX_ENTRIES = 30;

let started = false;

export function readFreezeLog(): FreezeEntry[] {
  try {
    return JSON.parse(deviceMeta.get(LOG_KEY) ?? "[]") as FreezeEntry[];
  } catch {
    return [];
  }
}

export function clearFreezeLog(): void {
  deviceMeta.set(LOG_KEY, "[]");
}

function append(entry: FreezeEntry) {
  try {
    const next = [entry, ...readFreezeLog()].slice(0, MAX_ENTRIES);
    deviceMeta.set(LOG_KEY, JSON.stringify(next));
  } catch {
    /* logging must never break the till */
  }
}

/** Start once, at app launch. Safe to call again. */
export function startFreezeMonitor(): void {
  if (started) return;
  started = true;

  // A heartbeat left over from a session that never reached the background
  // means the app died while open.
  try {
    const raw = deviceMeta.get(ALIVE_KEY);
    if (raw && raw !== "bg") {
      const last = Number(raw);
      if (Number.isFinite(last)) append({ at: last, kind: "restart", ms: Date.now() - last });
    }
  } catch {
    /* ignore */
  }

  let expected = Date.now() + TICK_MS;
  let beats = 0;
  setInterval(() => {
    const now = Date.now();
    const late = now - expected;
    expected = now + TICK_MS;
    if (AppState.currentState !== "active") return;
    if (late > FREEZE_MS) {
      append({ at: now - late, kind: "freeze", ms: late, syncing: getSyncActivity().busy });
    }
    // Writing every 5s keeps the cost tiny on old flash storage.
    beats += 1;
    if (beats % 5 === 0) {
      try {
        deviceMeta.set(ALIVE_KEY, String(now));
      } catch {
        /* ignore */
      }
    }
  }, TICK_MS);

  AppState.addEventListener("change", (state) => {
    try {
      // Backgrounded on purpose: not a crash if the OS later reclaims it.
      if (state !== "active") deviceMeta.set(ALIVE_KEY, "bg");
      else {
        expected = Date.now() + TICK_MS;
        deviceMeta.set(ALIVE_KEY, String(Date.now()));
      }
    } catch {
      /* ignore */
    }
  });
}
