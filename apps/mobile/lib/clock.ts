import { deviceMeta } from "./db";

/**
 * The till's best estimate of the real time.
 *
 * Every sale is stamped with the time on the device that made it, and that
 * time decides which day the sale lands on in every report. Old POS terminals
 * often have the wrong date or time (a flat clock battery resets it after a
 * power cut, or someone set it by hand), so a sale made at 9pm today could be
 * stamped as tomorrow.
 *
 * Each server response carries the server's own time. We store how far this
 * device's clock is from it and add that offset to every timestamp the app
 * writes. The offset is saved, so it keeps working while the till is offline.
 * The server also corrects anything that still arrives with a wrong time.
 */

const OFFSET_KEY = "clock_offset_ms_v1";
/** Ignore differences smaller than this: network delay, not a wrong clock. */
const NOISE_MS = 60_000;
/**
 * Above this the cashier is told to fix the device clock.
 *
 * This must match the server's `CLOCK_SKEW_MS` (store.do.ts). The server starts
 * re-dating a sale once the device clock is more than two minutes out, so
 * warning only at five let staff work through three minutes of silent
 * rewriting — the till printed one time, the ledger stored another.
 */
export const CLOCK_WARN_MS = 2 * 60_000;

let offset = (() => {
  try {
    const v = Number(deviceMeta.get(OFFSET_KEY));
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
})();

const listeners = new Set<() => void>();

/** Real time in ms, corrected for this device's clock error. */
export function trustedNow(): number {
  return Date.now() + offset;
}

/** How far the device clock is behind (+) or ahead (−) of the server, in ms. */
export function clockOffsetMs(): number {
  return offset;
}

export function subscribeClock(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * Learn the offset from a server response's `Date` header. `sentAt` is the
 * device time when the request left, so the server's second-resolution time
 * is compared with the middle of the round trip.
 */
export function learnClockFromResponse(res: Response, sentAt: number): void {
  try {
    const header = res.headers.get("date");
    if (!header) return;
    const server = Date.parse(header);
    if (!Number.isFinite(server)) return;
    const mid = sentAt + (Date.now() - sentAt) / 2;
    // The header drops milliseconds, so it reads up to 1s early.
    const measured = server + 500 - mid;
    const next = Math.abs(measured) < NOISE_MS ? 0 : Math.round(measured);
    if (Math.abs(next - offset) < 1000) return;
    offset = next;
    deviceMeta.set(OFFSET_KEY, String(offset));
    listeners.forEach((cb) => cb());
  } catch {
    /* never let clock bookkeeping break a sync */
  }
}
