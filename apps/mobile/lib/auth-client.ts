import Constants from "expo-constants";
import { createAuthClient } from "better-auth/react";
import type { BetterAuthClientPlugin } from "better-auth/client";
import { usernameClient } from "better-auth/client/plugins";
import { expoClient } from "@better-auth/expo/client";
import * as SecureStore from "expo-secure-store";

/**
 * better-auth client for the mobile app. The Expo plugin persists the session
 * cookie in the device secure store and handles the deep-link callback
 * (scheme "glspos", matching app.json + the server's trustedOrigins).
 *
 * Defaults to the deployed Worker so a physical device works with no setup.
 * Override with EXPO_PUBLIC_API_URL to target local `wrangler dev` (use your
 * machine's LAN IP on a real device — localhost only resolves on web/simulator).
 *
 * Requires `config.resolver.unstable_enablePackageExports = true` in
 * metro.config.js so Metro can resolve better-auth's subpath exports.
 */
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  "https://gls-pos-server.sphade012.workers.dev";

const STORAGE_PREFIX = "glspos";
const AUTH_COOKIE_STORAGE_KEY = `${STORAGE_PREFIX}_cookie`;
const AUTH_SESSION_STORAGE_KEY = `${STORAGE_PREFIX}_session_data`;
const PRINCIPAL_BINDING_STORAGE_KEY = `${STORAGE_PREFIX}_principal_binding`;
const EXPO_CHUNK_MARKER = "\u0001ba-chunks:";

const SHA_256_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

declare const AUTH_CREDENTIAL_MARKER: unique symbol;
export type AuthCredentialMarker = string & {
  readonly [AUTH_CREDENTIAL_MARKER]: true;
};

/** A synchronously captured, principal-bound credential for one exact token. */
export type BoundAuthCredential = Readonly<{
  cookie: string;
  userId: string;
  marker: AuthCredentialMarker;
}>;

type PrincipalBinding = {
  version: 2;
  marker: string;
  userId: string;
};

// The Expo plugin's inferred type doesn't line up with BetterAuthClientPlugin
// across the current better-auth versions (a known deep-generic mismatch in the
// fetch types). The runtime shape is correct, so we assert it here.
const expoPlugin = expoClient({
  scheme: "glspos",
  storagePrefix: STORAGE_PREFIX,
  storage: SecureStore,
}) as unknown as BetterAuthClientPlugin;

export const authClient = createAuthClient({
  baseURL: API_URL,
  // usernameClient enables signIn.username — staff log in with a handle, not an
  // email (see the server's auth factory for why).
  plugins: [expoPlugin, usernameClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;

/**
 * The stored session cookie, for attaching to hand-rolled fetches (the sync
 * endpoint). Returns "" when signed out or when secure storage is unavailable,
 * which makes callers fail closed while the app keeps working offline.
 *
 * `getCookie` is contributed by the Expo plugin at runtime; typed here since
 * plugin action inference is bypassed above.
 */
export function authCookie(): string {
  try {
    const client = authClient as unknown as { getCookie?: () => string | undefined };
    const cookie = client.getCookie?.();
    return typeof cookie === "string" ? cookie : "";
  } catch {
    return "";
  }
}

function rotateRight(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

/** Synchronous SHA-256 keeps raw session tokens out of persisted bindings. */
function sha256(value: string): string {
  const input = new TextEncoder().encode(value);
  const bitLength = input.length * 8;
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[input.length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const words = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const previous15 = words[index - 15]!;
      const previous2 = words[index - 2]!;
      const sigma0 =
        rotateRight(previous15, 7) ^ rotateRight(previous15, 18) ^ (previous15 >>> 3);
      const sigma1 =
        rotateRight(previous2, 17) ^ rotateRight(previous2, 19) ^ (previous2 >>> 10);
      words[index] =
        (words[index - 16]! + sigma0 + words[index - 7]! + sigma1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e!, 6) ^ rotateRight(e!, 11) ^ rotateRight(e!, 25);
      const choice = (e! & f!) ^ (~e! & g!);
      const temporary1 =
        (h! + sum1 + choice + SHA_256_CONSTANTS[index]! + words[index]!) >>> 0;
      const sum0 = rotateRight(a!, 2) ^ rotateRight(a!, 13) ^ rotateRight(a!, 22);
      const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const temporary2 = (sum0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d! + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }

    hash[0] = (hash[0]! + a!) >>> 0;
    hash[1] = (hash[1]! + b!) >>> 0;
    hash[2] = (hash[2]! + c!) >>> 0;
    hash[3] = (hash[3]! + d!) >>> 0;
    hash[4] = (hash[4]! + e!) >>> 0;
    hash[5] = (hash[5]! + f!) >>> 0;
    hash[6] = (hash[6]! + g!) >>> 0;
    hash[7] = (hash[7]! + h!) >>> 0;
  }

  return hash.map((part) => part.toString(16).padStart(8, "0")).join("");
}

/**
 * Build an order-independent, opaque identity marker from only Better Auth's
 * session-token cookie pieces. Other cookies and expiry metadata cannot change
 * it, and the raw token is never persisted in the principal binding.
 */
function sessionMarker(cookie: string): AuthCredentialMarker | null {
  const pieces = cookie
    .split(";")
    .flatMap((rawPart) => {
      const part = rawPart.trim();
      const separator = part.indexOf("=");
      if (separator <= 0) return [];

      const name = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();
      if (!name.includes("session_token") || !value) return [];
      return [`${name}=${value}`];
    })
    .sort();

  return pieces.length > 0
    ? (`sha256:${sha256(pieces.join(";"))}` as AuthCredentialMarker)
    : null;
}

function isPrincipalBinding(value: unknown): value is PrincipalBinding {
  if (!value || typeof value !== "object") return false;
  const binding = value as Partial<PrincipalBinding>;
  return (
    binding.version === 2 &&
    typeof binding.marker === "string" &&
    binding.marker.length > 0 &&
    typeof binding.userId === "string" &&
    binding.userId.length > 0
  );
}

function readPrincipalBinding(): PrincipalBinding | null {
  try {
    const raw = SecureStore.getItem(PRINCIPAL_BINDING_STORAGE_KEY);
    if (!raw) return null;
    const binding = JSON.parse(raw) as unknown;
    return isPrincipalBinding(binding) ? binding : null;
  } catch {
    return null;
  }
}

/** Return the bound user only when the current opaque token marker is exact. */
export function getBoundAuthPrincipalId(): string | null {
  const marker = sessionMarker(authCookie());
  if (!marker) return null;
  const binding = readPrincipalBinding();
  return binding?.marker === marker ? binding.userId : null;
}

/** Bind the current session-token cookie to a server-confirmed user. */
export function bindCurrentAuthPrincipal(userId: string): boolean {
  try {
    const marker = sessionMarker(authCookie());
    if (!marker || !userId) return false;

    const binding: PrincipalBinding = { version: 2, marker, userId };
    SecureStore.setItem(PRINCIPAL_BINDING_STORAGE_KEY, JSON.stringify(binding));
    return true;
  } catch {
    // Do not destroy an older binding here. The caller decides whether a failed
    // persistence attempt must revoke it to make future cold boot fail closed.
    return false;
  }
}

/** Capture the exact currently bound credential before any asynchronous work. */
export function captureBoundAuthCredential(
  expectedUserId?: string | null,
): BoundAuthCredential | null {
  const cookie = authCookie();
  const marker = sessionMarker(cookie);
  const binding = readPrincipalBinding();
  if (
    !cookie ||
    !marker ||
    !binding ||
    binding.marker !== marker ||
    (expectedUserId != null && binding.userId !== expectedUserId)
  ) {
    return null;
  }
  return Object.freeze({ cookie, userId: binding.userId, marker });
}

/**
 * Capture the current cookie for teardown using an already server-confirmed
 * in-memory principal. This deliberately bypasses only the persisted cold-boot
 * binding; normal authorization and push registration must never use it.
 */
export function captureAuthCredentialForTeardown(
  confirmedUserId: string | null,
): BoundAuthCredential | null {
  if (!confirmedUserId) return null;
  const cookie = authCookie();
  const marker = sessionMarker(cookie);
  return cookie && marker
    ? Object.freeze({ cookie, userId: confirmedUserId, marker })
    : null;
}

/** Check that a captured principal still owns the exact current session token. */
export function isExactCurrentAuthCredential(credential: BoundAuthCredential): boolean {
  const marker = sessionMarker(authCookie());
  if (!marker || marker !== credential.marker) return false;
  const binding = readPrincipalBinding();
  return binding?.marker === credential.marker && binding.userId === credential.userId;
}

/** Revoke the cookie-to-user association synchronously. */
export function clearAuthPrincipalBinding(): void {
  try {
    SecureStore.setItem(PRINCIPAL_BINDING_STORAGE_KEY, "{}");
  } catch {
    // SecureStore is unavailable on some platforms; reads already fail closed.
  }
}

function clearExpoStorageKey(key: string): void {
  let chunkCount = 0;
  try {
    const current = SecureStore.getItem(key);
    if (current?.startsWith(EXPO_CHUNK_MARKER)) {
      const parsedCount = Number(current.slice(EXPO_CHUNK_MARKER.length));
      if (Number.isInteger(parsedCount) && parsedCount > 0) chunkCount = parsedCount;
    }
  } catch {
    // Still attempt the base-key overwrite below.
  }

  try {
    // The Expo plugin treats this as an empty cookie/cache object. Overwriting
    // synchronously avoids an async delete racing a subsequent fast sign-in.
    SecureStore.setItem(key, "{}");
  } catch {
    // Best effort; callers must continue to treat storage errors as signed out.
  }

  for (let index = 0; index < chunkCount; index += 1) {
    try {
      SecureStore.setItem(`${key}.${index}`, "");
    } catch {
      // The base key is already inert, so orphaned chunks are never reassembled.
    }
  }
}

/** Defensively clear the Expo Better Auth cookie and local session cache. */
export function clearLocalAuthStorage(): void {
  clearExpoStorageKey(AUTH_COOKIE_STORAGE_KEY);
  clearExpoStorageKey(AUTH_SESSION_STORAGE_KEY);
}
