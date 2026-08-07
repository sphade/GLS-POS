import { StyleSheet, Text, View } from "react-native";
import { colors } from "@/constants/theme";

export type Bar = { label: string; value: number };

/**
 * Lightweight bars-from-Views chart (no chart lib needed). Renders a 0-based
 * y-axis with a few gridlines, columns sized by value, and rotated x labels —
 * matching the report drill-down chart.
 */
export function BarChart({
  data,
  formatValue,
  height = 190,
  barColor = colors.primary,
}: {
  data: Bar[];
  formatValue: (n: number) => string;
  height?: number;
  barColor?: string;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const ticks = [1, 0.75, 0.5, 0.25, 0].map((f) => Math.round(max * f));
  const plotHeight = height - 34; // leave room for rotated x labels

  return (
    <View style={styles.card}>
      <View style={{ flexDirection: "row", height: plotHeight }}>
        {/* Y axis */}
        <View style={styles.axis}>
          {ticks.map((t, i) => (
            <Text key={i} style={styles.axisText} numberOfLines={1}>
              {formatValue(t)}
            </Text>
          ))}
        </View>

        {/* Plot */}
        <View style={styles.plot}>
          {ticks.map((_, i) => (
            <View key={i} style={[styles.gridline, { top: (plotHeight / (ticks.length - 1)) * i }]} />
          ))}
          <View style={styles.bars}>
            {data.map((d, i) => (
              <View key={i} style={styles.barCol}>
                <View
                  style={{
                    width: 34,
                    height: Math.max(2, (d.value / max) * (plotHeight - 6)),
                    backgroundColor: barColor,
                    borderTopLeftRadius: 2,
                    borderTopRightRadius: 2,
                  }}
                />
              </View>
            ))}
          </View>
        </View>
      </View>

      {/* X labels */}
      <View style={styles.xRow}>
        <View style={{ width: 44 }} />
        <View style={styles.xLabels}>
          {data.map((d, i) => (
            <View key={i} style={styles.xLabelCol}>
              <Text style={styles.xLabel} numberOfLines={1}>
                {d.label}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: 4, padding: 12, margin: 10, elevation: 1 },
  axis: { width: 44, justifyContent: "space-between", alignItems: "flex-end", paddingRight: 4 },
  axisText: { fontSize: 9, color: colors.grey500 },
  plot: { flex: 1, position: "relative", justifyContent: "flex-end" },
  gridline: { position: "absolute", left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: colors.grey300 },
  bars: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-around", height: "100%" },
  barCol: { flex: 1, alignItems: "center", justifyContent: "flex-end" },
  xRow: { flexDirection: "row", marginTop: 6 },
  xLabels: { flex: 1, flexDirection: "row", justifyContent: "space-around" },
  xLabelCol: { flex: 1, alignItems: "center" },
  xLabel: { fontSize: 9, color: colors.grey600, transform: [{ rotate: "-18deg" }] },
});
