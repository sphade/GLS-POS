import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";

/**
 * Round product avatar: the item's initials on a tint of its category colour.
 *
 * `size` accepts a pixel number (what the Items grid and variant sheet pass) or
 * a preset. It previously looked the number up in the preset table, got
 * `undefined`, and crashed with "Cannot read property 'padding' of undefined".
 */
interface ProductAvatarProps {
  product?: { name: string; categoryId?: string };
  name?: string;
  size?: "small" | "medium" | "large" | number;
  color?: string;
  /** Kept for API compatibility; the avatar no longer renders a price. */
  price?: number;
  showPrice?: boolean;
}

const PRESETS = { small: 40, medium: 70, large: 100 } as const;

function initialsOf(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function hashColor(key: string) {
  const palette = ["#E65100", "#1565C0", "#6A1B9A", "#C62828", "#2E7D32", "#00838F"];
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = key.charCodeAt(i) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
}

export const ProductAvatar = memo(function ProductAvatar({ product, name, size = "medium", color }: ProductAvatarProps) {
  const label = product?.name ?? name ?? "";
  const px = typeof size === "number" ? size : PRESETS[size] ?? PRESETS.medium;
  const tone = color ?? (product?.categoryId ? hashColor(product.categoryId) : hashColor(label));

  return (
    <View
      style={[
        styles.circle,
        { width: px, height: px, borderRadius: px / 2, backgroundColor: `${tone}1F`, borderColor: `${tone}40` },
      ]}
    >
      <Text style={[styles.text, { color: tone, fontSize: Math.max(11, Math.round(px * 0.34)) }]} numberOfLines={1}>
        {initialsOf(label)}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  circle: { alignItems: "center", justifyContent: "center", borderWidth: 1.5, overflow: "hidden" },
  text: { fontWeight: "800", letterSpacing: 0.5, includeFontPadding: false },
});
