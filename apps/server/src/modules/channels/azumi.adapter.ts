/**
 * Azumi Deliveries vendor integration API (/api/integrations/v1), the same
 * contract Azumi POS uses. A shop owner creates a key in the Azumi vendor
 * dashboard (Integrations) and pastes it into GLS POS. Money is integer kobo.
 */
import type { ExternalMenuItem } from "@gls-pos/types";
import type { Env } from "../../env.js";

export class ChannelApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** One availability change for one Azumi item or add-on. */
export interface ItemPush {
  ref: string;
  kind?: "item" | "option";
  inStock: boolean;
}

async function call<T>(url: string, apiKey: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const msg =
      (body?.message as string) ||
      ((body?.error as { message?: string } | undefined)?.message ?? (body?.error as string)) ||
      `Azumi request failed (${res.status})`;
    throw new ChannelApiError(res.status, String(msg));
  }
  return body as T;
}

const chunks = <T>(list: T[], size: number) =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));

export function azumiAdapter(env: Env) {
  const base = `${(env.AZUMI_API_URL ?? "https://server.azumi.com.ng").replace(/\/$/, "")}/api/integrations/v1`;
  return {
    /** Checks the key and returns the shop's name on Azumi. */
    async me(apiKey: string): Promise<{ name?: string }> {
      const res = await call<{ data: { shop?: { name?: string } } }>(`${base}/me`, apiKey);
      return { name: res.data.shop?.name };
    },

    async menu(apiKey: string): Promise<ExternalMenuItem[]> {
      const res = await call<{
        data: {
          categories: { id: string; name: string }[];
          items: { id: string; name: string; price: number; inStock: boolean; categoryId: string }[];
          options?: { id: string; name: string; price: number; inStock: boolean }[];
        };
      }>(`${base}/menu`, apiKey);
      const cats = new Map(res.data.categories.map((c) => [c.id, c.name]));
      return [
        ...res.data.items.map((i) => ({
          ref: i.id,
          name: i.name,
          price: i.price,
          inStock: i.inStock,
          category: cats.get(i.categoryId),
          kind: "item" as const,
        })),
        ...(res.data.options ?? []).map((o) => ({
          ref: o.id,
          name: o.name,
          price: o.price,
          inStock: o.inStock,
          kind: "option" as const,
        })),
      ];
    },

    async pushItems(apiKey: string, items: ItemPush[]): Promise<void> {
      for (const part of chunks(items, 200)) {
        await call(`${base}/menu/items`, apiKey, {
          method: "PATCH",
          body: JSON.stringify({
            items: part.map((i) => ({ id: i.ref, type: i.kind ?? "item", inStock: i.inStock })),
          }),
        });
      }
    },
  };
}
