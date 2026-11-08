/**
 * Encryption for delivery-app credentials at rest (AES-256-GCM).
 *
 * The key is derived from the Worker's existing BETTER_AUTH_SECRET, so no new
 * secret has to be provisioned, and a dump of Durable Object storage alone
 * cannot recover a shop's Azumi API key. (Ported from Azumi POS.)
 */

async function keyFor(secret: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${secret}:gls-pos:channels:v1`),
  );
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export async function sealSecret(secret: string, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await keyFor(secret),
    new TextEncoder().encode(plain),
  );
  return `v1.${b64(iv)}.${b64(new Uint8Array(cipher))}`;
}

export async function openSecret(secret: string, sealed: string): Promise<string> {
  const [version, iv, data] = sealed.split(".");
  if (version !== "v1" || !iv || !data) throw new Error("bad_sealed_secret");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(iv) },
    await keyFor(secret),
    unb64(data),
  );
  return new TextDecoder().decode(plain);
}
