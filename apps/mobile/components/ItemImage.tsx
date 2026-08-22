import { memo, useEffect, useState } from "react";
import { PixelRatio, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { colors } from "@/constants/theme";
import { cachedImageUri, getImageUri } from "@/lib/image-store";

/**
 * Product thumbnail. Memoised and self-contained so a cart change (or any
 * parent re-render) doesn't force every tile in the grid to reload its photo.
 *
 * Resolves the image lazily: shows the coloured initial immediately, then swaps
 * in the cached `file://` image once it's materialised. Uses expo-image for its
 * memory + disk cache and cheap `recyclingKey` reuse while scrolling.
 */
export const ItemImage = memo(function ItemImage({
  productId,
  name,
  size,
  color,
  hasImage,
  remoteUrl,
}: {
  productId: string;
  name: string;
  size: number;
  color: string;
  /** True when a stored image exists for this product. */
  hasImage: boolean;
  /** Optional fallback while the local copy is still being written. */
  remoteUrl?: string;
}) {
  // Synchronous cache peek avoids a blank frame for already-loaded images.
  const [uri, setUri] = useState<string | null>(() => cachedImageUri(productId) ?? null);

  useEffect(() => {
    if (!hasImage || uri) return;
    let alive = true;
    void getImageUri(productId).then((u) => {
      if (alive && u) setUri(u);
    });
    return () => {
      alive = false;
    };
  }, [productId, hasImage, uri]);

  const source = uri ?? (hasImage ? remoteUrl : undefined);
  const radius = size / 2;
  // Physical pixels for this view, so the bitmap is crisp but not oversized.
  const decodePx = Math.round(size * PixelRatio.get());

  return (
    <View
      style={[
        styles.wrap,
        { width: size, height: size, borderRadius: radius, backgroundColor: color },
      ]}
    >
      {source ? (
        <Image
          /**
           * The decode size is pinned to the size actually drawn.
           *
           * Product photos are full-resolution (the seeded menu is 1600x900),
           * which decodes to ~5.5MB of bitmap *each*. Rendered untouched into a
           * ~78px circle, a catalog of 62 items needs ~341MB — past Android's
           * 256MB heap ceiling, which is what produced the OutOfMemoryError.
           * Handing the decoder a target size keeps each bitmap at thumbnail
           * cost while staying sharp on high-density screens.
           */
          source={{ uri: source, width: decodePx, height: decodePx }}
          style={{ width: size, height: size, borderRadius: radius }}
          contentFit="cover"
          allowDownscaling
          recyclingKey={productId}
          cachePolicy="memory-disk"
          transition={80}
        />
      ) : (
        <Text style={[styles.initial, { fontSize: size * 0.4 }]}>
          {name?.charAt(0).toUpperCase() ?? "?"}
        </Text>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
  initial: { color: colors.white, fontWeight: "800" },
});
