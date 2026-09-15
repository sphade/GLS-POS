import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "@/constants/theme";

/** Lightweight product marker used everywhere menu items are shown. */
export const ProductAvatar = memo(function ProductAvatar({
  name,
  size,
  color,
}: {
  name: string;
  size: number;
  color: string;
}) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";

  return (
    <View
      accessible={false}
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
        },
      ]}
    >
      <Text style={[styles.initial, { fontSize: size * 0.4 }]}>{initial}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  avatar: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
  initial: { color: colors.white, fontWeight: "800" },
});
