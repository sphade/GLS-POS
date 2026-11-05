import { Redirect, useLocalSearchParams } from "expo-router";

/**
 * Landing for old central-stock routes, kept so notifications and deep links
 * from earlier builds still open something useful. Central and branch stock
 * now live in each store's ingredients, edited in one place.
 */
export function LegacyStockRedirect({ to }: { to: "/ingredient-editor" | "/inventory" }) {
  const { id, itemId } = useLocalSearchParams<{ id?: string; itemId?: string }>();
  const target = id ?? itemId;
  const href = target && to === "/ingredient-editor" ? `${to}?id=${encodeURIComponent(target)}` : to;
  return <Redirect href={href as never} />;
}
