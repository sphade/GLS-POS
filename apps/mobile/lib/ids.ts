/**
 * Document ids for locally-created records.
 *
 * Every id in this app is minted offline, on a device, and only later meets the
 * ids other tills minted while disconnected. The store Durable Object keys its
 * documents by `(collection, id)`, so two devices that pick the same id do not
 * conflict — the second one to sync silently overwrites the first. For a
 * receipt that means a completed, printed, paid-for sale disappearing.
 *
 * The previous generators were `${prefix}_${Date.now()}` (receipts and held
 * bills) plus three separate time+random variants. A timestamp alone collides
 * whenever two tills ring up a sale in the same millisecond, which on a busy
 * lunch service is not a remote possibility. Even time+random collides more
 * often than it should, because `Math.random()` is per-process and two devices
 * booted from the same image can walk similar sequences.
 *
 * An id here is therefore three independent parts:
 *
 *  - **time**    — base36 milliseconds, so ids sort roughly chronologically and
 *                  stay readable in logs.
 *  - **device**  — a random token minted once per install and persisted in the
 *                  device-scoped meta table. This is what makes two tills
 *                  unable to collide, no matter how their clocks or random
 *                  sequences line up.
 *  - **counter + random** — separates ids minted inside one millisecond on one
 *                  device, which is exactly what a fast batch of stock
 *                  movements does.
 *
 * Ids are opaque everywhere: nothing parses them, so the format can change
 * without a migration, and ids already on disk stay valid.
 */

import { deviceMeta } from "./db";

const DEVICE_TOKEN_KEY = "device_id_v1";
const DEVICE_TOKEN_LENGTH = 10;

/** Lower-case base36 token of exactly `length` characters. */
function randomToken(length: number): string {
  let token = "";
  while (token.length < length) {
    token += Math.random().toString(36).slice(2);
  }
  return token.slice(0, length);
}

let cachedDeviceToken: string | null = null;

/**
 * Stable per-install identifier, in the bootstrap database so it survives store
 * switches and is never confused with another shop's data.
 *
 * Resolved lazily: this module must not touch SQLite at import time, because it
 * is imported before any store (or even the bootstrap file) is opened.
 */
export function deviceToken(): string {
  if (cachedDeviceToken) return cachedDeviceToken;

  let stored: string | null = null;
  try {
    stored = deviceMeta.get(DEVICE_TOKEN_KEY);
  } catch {
    // Storage unavailable this early — fall through to an in-memory token so
    // ids stay unique for this session rather than failing the write outright.
  }

  if (!stored || !/^[0-9a-z]{6,32}$/.test(stored)) {
    stored = randomToken(DEVICE_TOKEN_LENGTH);
    try {
      deviceMeta.set(DEVICE_TOKEN_KEY, stored);
    } catch {
      /* not persisted; still unique for this run */
    }
  }

  cachedDeviceToken = stored;
  return stored;
}

/** Wraps well before base36 overflow and only needs to be locally distinct. */
let counter = Math.floor(Math.random() * 46_656);

/**
 * A collision-proof id for a locally-created document.
 *
 * `prefix` is the short entity tag used across the codebase (`rcpt`, `mov`,
 * `ret`, `aud`, `held`, `prod`, …).
 */
export function uid(prefix: string): string {
  counter = (counter + 1) % 46_656; // 36^3
  const time = Date.now().toString(36);
  const sequence = counter.toString(36).padStart(3, "0");
  return `${prefix}_${time}${sequence}_${deviceToken()}${randomToken(4)}`;
}
