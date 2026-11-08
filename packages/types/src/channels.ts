/**
 * Delivery apps a shop also sells through. GLS POS is the source of truth for
 * stock: each POS product can be LINKED to its listing on an app, and the
 * server keeps that listing in or out of stock to match the POS.
 *
 * Links are stored server-side (in the store's Durable Object), not on the
 * product document, so an older app build that rewrites a product can never
 * drop a link it doesn't know about.
 */

export type SalesChannel = "azumi";

export const SALES_CHANNELS: readonly SalesChannel[] = ["azumi"];

/** A menu item as the app reports it. Money in kobo. */
export interface ExternalMenuItem {
  ref: string;
  name: string;
  price: number;
  inStock: boolean;
  category?: string;
  /** "option" = an add-on (e.g. a drink choice), not a menu item. */
  kind?: "item" | "option";
}

/** One POS product linked to one item (or add-on) on an app. */
export interface ChannelLink {
  productId: string;
  ref: string;
  kind?: "item" | "option";
  /** Set when linking automatically by name, so the UI can say so. */
  auto?: boolean;
}

/** Public (no secrets) view of a connection, for the POS UI. */
export interface ChannelStatus {
  channel: SalesChannel;
  connected: boolean;
  /** Shop name as the app knows it. */
  remoteName?: string;
  connectedAt?: number;
  lastSyncAt?: number;
  lastError?: string;
  linkedCount: number;
}

/** What the "Delivery apps" screen needs to show and edit links. */
export interface ChannelLinkView {
  menu: ExternalMenuItem[];
  links: ChannelLink[];
}
