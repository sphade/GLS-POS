/**
 * Hard offline switch: when on, the app runs with the backend completely
 * stripped out of its runtime path — no sign-in round-trip, no store registry,
 * no sync, no realtime, no push registration. The app boots straight into a
 * synthetic owner session against a purely local SQLite store.
 *
 * Used to isolate the local CRUD layer from server behaviour while debugging.
 * Flip with EXPO_PUBLIC_OFFLINE_MODE=1 (see .env).
 */
export const OFFLINE_MODE = process.env.EXPO_PUBLIC_OFFLINE_MODE === "1";

/** The synthetic store every offline device runs against. */
export const LOCAL_STORE_ID = "local";

export const LOCAL_STORE_MEMBERSHIP = {
  id: LOCAL_STORE_ID,
  name: "GLS Local",
  currency: "NGN" as const,
  role: "owner" as const,
};

export const LOCAL_USER = { id: "local", name: "Staff", email: "staff@local" };
