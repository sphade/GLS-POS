import { Image, StyleSheet, Text, View } from "react-native";
import { colors } from "@/constants/theme";

/** Mascot-based empty state, matching the layout used across Zobaze's tabs. */
export function EmptyState({ text, size = 140 }: { text: string; size?: number }) {
  return (
    <View style={styles.wrap}>
      <Image
        source={require("../assets/images/mascot_1.webp")}
        style={{ width: size, height: size }}
        resizeMode="contain"
      />
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center", paddingHorizontal: 30 },
  text: { marginTop: 22, fontSize: 16, color: colors.grey600, textAlign: "center" },
});
