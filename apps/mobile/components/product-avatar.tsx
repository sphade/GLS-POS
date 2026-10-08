import { StyleSheet, Text, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { colors } from "@/constants/theme";
import { formatMoney } from "@/constants/theme";

interface ProductAvatarProps {
  product?: { name: string; price: number; categoryId?: string; image?: string; stockQuantity?: number };
  name?: string;
  price?: number;
  size?: "small" | "medium" | "large" | number;
  showPrice?: boolean;
  color?: string;
}

export function ProductAvatar({
  product,
  name,
  price,
  size = "medium",
  showPrice = true,
  color,
}: ProductAvatarProps) {
  // Handle both product object and individual props
  const productName = product?.name || name || "";
  const productPrice = product?.price || price || 0;
  const productStockQuantity = product?.stockQuantity;
  const isOutOfStock = productStockQuantity === 0;
  
  const categoryColor = color || (product?.categoryId ? getCategoryColor(product.categoryId) : colors.primary);

  // Normalize size to number
  const sizeValue = typeof size === "number" ? size : getSizes(size).image;
  
  const sizes = getSizes(size as "small" | "medium" | "large");

  return (
    <View
      style={[
        styles.container,
        { padding: sizes.padding, borderRadius: 8, backgroundColor: isOutOfStock ? "#FFF5F5" : colors.card },
      ]}
    >
      <View style={styles.content}>
        <View
          style={[
            styles.imageContainer,
            { width: sizeValue, height: sizeValue, borderRadius: 6 },
          ]}
        >
          <View style={[styles.placeholder, { backgroundColor: `${categoryColor}20` }]}>
            <MaterialIcons name="inventory" size={sizeValue / 2.5} color={categoryColor} />
          </View>
        </View>

        <View style={styles.info}>
          <Text style={[styles.name, { fontSize: sizes.fontSize, fontWeight: "600" }]} numberOfLines={2}>
            {productName}
          </Text>

          {showPrice && (
            <Text style={[styles.price, { fontSize: sizes.fontSize }]}>
              {formatMoney(productPrice)}
            </Text>
          )}
        </View>
      </View>

      {isOutOfStock && (
        <View style={styles.overlay}>
          <Text style={styles.outOfStockText}>Out of stock</Text>
        </View>
      )}
    </View>
  );
}

function getSizes(size: "small" | "medium" | "large") {
  return {
    small: { image: 40, fontSize: 10, padding: 4 },
    medium: { image: 70, fontSize: 12, padding: 8 },
    large: { image: 100, fontSize: 14, padding: 12 },
  }[size];
}

function getCategoryColor(catName: string) {
  const catColors = ["#FF9800", "#2196F3", "#9C27B0", "#FF5722", "#4CAF50"];
  let hash = 0;
  for (let i = 0; i < catName.length; i++) {
    hash = catName.charCodeAt(i) + ((hash << 5) - hash);
  }
  return catColors[Math.abs(hash) % catColors.length];
}

const styles = StyleSheet.create({
  container: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.grey300,
  },
  content: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  imageContainer: {
    position: "relative",
    marginRight: 8,
    backgroundColor: colors.grey300,
  },
  placeholder: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  info: {
    flex: 1,
    paddingVertical: 2,
  },
  name: {
    color: colors.textTitle,
    marginBottom: 2,
    lineHeight: 14,
  },
  price: {
    color: colors.primary,
    fontWeight: "700",
    marginBottom: 1,
    lineHeight: 12,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(255, 255, 255, 0.8)",
    alignItems: "center",
    justifyContent: "center",
  },
  outOfStockText: {
    color: colors.red500,
    fontWeight: "700",
    fontSize: 12,
    paddingVertical: 4,
    paddingHorizontal: 12,
    backgroundColor: colors.red500,
    borderRadius: 4,
  },
});
