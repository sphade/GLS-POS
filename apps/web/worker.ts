/**
 * Cloudflare Worker for GLS Kitchen & Bakery website + built-in CMS.
 *
 * Static assets live in `build/` (served by `env.ASSETS`). Dynamic CMS routes
 * and uploaded media live in a single Cloudflare R2 bucket (`env.CMS_BUCKET`):
 *   - `cms/content.json`        — editable copy, links & image URL overrides
 *   - `media/<slot>-<ts>.<ext>` — images uploaded from /admin
 *
 * Admin auth uses Worker secrets (`CMS_ADMIN_USER`, `CMS_ADMIN_PASS`,
 * `CMS_SESSION_SECRET`) and an HMAC-SHA256 signed HttpOnly cookie.
 */

interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface R2HTTPMetadata {
  contentType?: string;
  cacheControl?: string;
}

interface R2ObjectBody {
  body: ReadableStream;
  httpEtag: string;
  httpMetadata?: R2HTTPMetadata;
  text(): Promise<string>;
}

interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | string,
    options?: { httpMetadata?: R2HTTPMetadata },
  ): Promise<unknown>;
  delete(key: string): Promise<void>;
}

export interface Env {
  ASSETS: Fetcher;
  CMS_BUCKET: R2Bucket;
  CMS_ADMIN_USER?: string;
  CMS_ADMIN_PASS?: string;
  CMS_SESSION_SECRET?: string;
}

const CONTENT_KEY = "cms/content.json";
const COOKIE_NAME = "gls_cms_session";
const SESSION_TTL_SEC = 60 * 60 * 24 * 7; // 7 days
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  const len = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

async function hmacSign(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function parseCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

async function createSessionToken(user: string, secret: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
  const payload = btoa(JSON.stringify({ u: user, exp }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const sig = await hmacSign(secret, payload);
  return `${payload}.${sig}`;
}

async function verifySessionToken(
  token: string | null,
  secret: string,
): Promise<{ user: string } | null> {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = await hmacSign(secret, payload);
  if (!timingSafeEqual(sig, expected)) return null;
  try {
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((payload.length + 3) % 4);
    const parsed = JSON.parse(atob(padded)) as { u?: unknown; exp?: unknown };
    if (typeof parsed.u !== "string" || typeof parsed.exp !== "number") return null;
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return { user: parsed.u };
  } catch {
    return null;
  }
}

function sessionSecret(env: Env): string {
  return env.CMS_SESSION_SECRET || env.CMS_ADMIN_PASS || "";
}

async function requireAdmin(request: Request, env: Env): Promise<{ user: string } | null> {
  const secret = sessionSecret(env);
  if (!secret) return null;
  const token = parseCookie(request.headers.get("cookie"), COOKIE_NAME);
  return verifySessionToken(token, secret);
}

function cookieHeader(value: string, maxAge: number, isHttps: boolean): string {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (isHttps) parts.push("Secure");
  return parts.join("; ");
}

function sanitizeSlot(raw: string): string {
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 48);
  return cleaned || "image";
}

function sanitizeContent(input: unknown): Record<string, string> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const out: Record<string, string> = {};
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > 300) return null;
  for (const [key, val] of entries) {
    if (!/^[a-z0-9_]{1,64}$/i.test(key)) continue;
    if (typeof val !== "string") continue;
    const trimmed = val.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.length > 4000) return null;
    out[key] = trimmed;
  }
  return out;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const isHttps = url.protocol === "https:";

    // Serve uploaded R2 images at /media/<key>
    if (pathname.startsWith("/media/")) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method Not Allowed", { status: 405 });
      }
      const key = pathname.slice(1); // "media/..."
      if (key.includes("..") || !/^media\/[a-zA-Z0-9._-]+$/.test(key)) {
        return new Response("Not Found", { status: 404 });
      }
      const obj = await env.CMS_BUCKET.get(key);
      if (!obj) return new Response("Not Found", { status: 404 });
      const headers = new Headers();
      headers.set("content-type", obj.httpMetadata?.contentType ?? "application/octet-stream");
      headers.set("etag", obj.httpEtag);
      headers.set("cache-control", "public, max-age=31536000, immutable");
      if (request.method === "HEAD") {
        return new Response(null, { status: 200, headers });
      }
      return new Response(obj.body, { status: 200, headers });
    }

    // Public CMS content read
    if (pathname === "/api/cms/content" && request.method === "GET") {
      try {
        const obj = await env.CMS_BUCKET.get(CONTENT_KEY);
        if (!obj) {
          return json({}, 200, { "cache-control": "no-cache" });
        }
        const text = await obj.text();
        return new Response(text, {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-cache",
          },
        });
      } catch {
        return json({}, 200, { "cache-control": "no-cache" });
      }
    }

    // Admin session check
    if (pathname === "/api/cms/me" && request.method === "GET") {
      const session = await requireAdmin(request, env);
      if (!session) return json({ authenticated: false }, 200);
      return json({ authenticated: true, user: session.user }, 200);
    }

    // Admin login
    if (pathname === "/api/cms/login" && request.method === "POST") {
      if (!env.CMS_ADMIN_USER || !env.CMS_ADMIN_PASS) {
        return json({ error: "CMS admin credentials are not configured on the server." }, 503);
      }
      let body: { username?: unknown; password?: unknown };
      try {
        body = (await request.json()) as { username?: unknown; password?: unknown };
      } catch {
        return json({ error: "Invalid request body." }, 400);
      }
      const username = typeof body.username === "string" ? body.username.trim() : "";
      const password = typeof body.password === "string" ? body.password : "";
      const userOk = timingSafeEqual(username.toLowerCase(), env.CMS_ADMIN_USER.trim().toLowerCase());
      const passOk = timingSafeEqual(password, env.CMS_ADMIN_PASS);
      if (!userOk || !passOk) {
        return json({ error: "Incorrect username or password." }, 401);
      }
      const token = await createSessionToken(env.CMS_ADMIN_USER.trim(), sessionSecret(env));
      return json(
        { ok: true, user: env.CMS_ADMIN_USER.trim() },
        200,
        { "set-cookie": cookieHeader(token, SESSION_TTL_SEC, isHttps) },
      );
    }

    // Admin logout
    if (pathname === "/api/cms/logout" && request.method === "POST") {
      return json(
        { ok: true },
        200,
        { "set-cookie": cookieHeader("", 0, isHttps) },
      );
    }

    // Admin save content
    if (pathname === "/api/cms/content" && request.method === "PUT") {
      const session = await requireAdmin(request, env);
      if (!session) return json({ error: "Unauthorized. Please sign in again." }, 401);
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Invalid JSON payload." }, 400);
      }
      const sanitized = sanitizeContent(body);
      if (!sanitized) return json({ error: "Invalid content structure." }, 400);
      await env.CMS_BUCKET.put(CONTENT_KEY, JSON.stringify(sanitized), {
        httpMetadata: { contentType: "application/json; charset=utf-8" },
      });
      return json({ ok: true, count: Object.keys(sanitized).length }, 200);
    }

    // Admin upload image to R2
    if (pathname === "/api/cms/upload" && request.method === "POST") {
      const session = await requireAdmin(request, env);
      if (!session) return json({ error: "Unauthorized. Please sign in again." }, 401);
      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        return json({ error: "Expected multipart form upload." }, 400);
      }
      const file = form.get("file");
      if (!(file instanceof File)) {
        return json({ error: "No image file provided." }, 400);
      }
      const ext = ALLOWED_IMAGE_TYPES[file.type];
      if (!ext) {
        return json({ error: "Unsupported image format. Use JPG, PNG, WebP, GIF, or AVIF." }, 400);
      }
      if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
        return json({ error: "Image must be under 10 MB." }, 400);
      }
      const slot = sanitizeSlot(String(form.get("slot") ?? "image"));
      const rand = Math.random().toString(36).slice(2, 8);
      const key = `media/${slot}-${Date.now()}-${rand}.${ext}`;
      const buffer = await file.arrayBuffer();
      await env.CMS_BUCKET.put(key, buffer, {
        httpMetadata: {
          contentType: file.type,
          cacheControl: "public, max-age=31536000, immutable",
        },
      });
      return json({ ok: true, key, url: `/${key}` }, 200);
    }

    // Everything else served from static assets (including /admin -> admin.html)
    return env.ASSETS.fetch(request);
  },
};
