import { memo, useCallback, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "@/constants/theme";

const COUNTER_IDS = Array.from({ length: 10 }, (_, index) => index + 1);
const TOGGLE_IDS = ["Alpha", "Bravo", "Charlie", "Delta"] as const;

/**
 * Deliberately isolated UI control screen.
 *
 * Everything below is local React state. Do not add app contexts, storage,
 * network, audio, haptics, or other side effects: this route exists to compare
 * basic React Native interaction performance with the real POS screens.
 */
export default function PerformanceScreen() {
  const [resetVersion, setResetVersion] = useState(0);

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>DIAGNOSTIC CONTROL</Text>
        <Text style={styles.headerTitle}>Local UI Performance Test</Text>
        <Text style={styles.headerSubtitle}>Tap quickly and watch for delayed presses, skipped frames, or freezes.</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="always"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.isolationCard}>
          <View style={styles.statusDot} />
          <View style={styles.isolationCopy}>
            <Text style={styles.isolationTitle}>Screen integrations: none</Text>
            <Text style={styles.isolationText}>No API · No database · No sync · No audio · No haptics</Text>
          </View>
        </View>

        <RapidTapPanel key={`rapid-${resetVersion}`} />
        <MotionPanel key={`motion-${resetVersion}`} />

        <View style={styles.sectionHeader}>
          <View style={styles.sectionHeadingCopy}>
            <Text style={styles.sectionTitle}>INDEPENDENT COUNTERS</Text>
            <Text style={styles.sectionHint}>Only the counter you press should update.</Text>
          </View>
          <Pressable
            accessibilityLabel="Reset all local controls"
            accessibilityRole="button"
            android_ripple={{ color: "#5AA02C20" }}
            onPress={() => setResetVersion((version) => version + 1)}
            style={({ pressed }) => [styles.resetButton, pressed && styles.pressed]}
          >
            <Text style={styles.resetButtonText}>Reset all</Text>
          </Pressable>
        </View>

        <View style={styles.counterGrid}>
          {COUNTER_IDS.map((id) => (
            <CounterTile key={`${resetVersion}-${id}`} id={id} />
          ))}
        </View>

        <Text style={[styles.sectionTitle, styles.toggleHeading]}>LOCAL SWITCHES</Text>
        <View style={styles.toggleCard}>
          {TOGGLE_IDS.map((label, index) => (
            <ToggleRow
              key={`${resetVersion}-${label}`}
              label={label}
              showDivider={index < TOGGLE_IDS.length - 1}
            />
          ))}
        </View>

        <View style={styles.interpretationCard}>
          <Text style={styles.interpretationTitle}>How to read this test</Text>
          <Text style={styles.interpretationText}>
            If these controls stay smooth while POS screens lag, the expensive work is in those screens or their
            subscriptions. If this page also stalls, root providers, background sync, native modules, or the runtime are
            affecting the whole app.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const CounterTile = memo(function CounterTile({ id }: { id: number }) {
  const [value, setValue] = useState(0);

  return (
    <View style={styles.counterCard}>
      <Text style={styles.counterLabel}>Counter {id}</Text>
      <Text style={styles.counterValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <View style={styles.counterActions}>
        <Pressable
          accessibilityLabel={`Decrease counter ${id}`}
          accessibilityRole="button"
          android_ripple={{ color: "#E5393524" }}
          onPress={() => setValue((current) => current - 1)}
          style={({ pressed }) => [styles.counterButton, pressed && styles.pressed]}
        >
          <Text style={[styles.counterButtonText, styles.minusText]}>−</Text>
        </Pressable>
        <View style={styles.counterDivider} />
        <Pressable
          accessibilityLabel={`Increase counter ${id}`}
          accessibilityRole="button"
          android_ripple={{ color: "#3FA34D24" }}
          onPress={() => setValue((current) => current + 1)}
          style={({ pressed }) => [styles.counterButton, pressed && styles.pressed]}
        >
          <Text style={[styles.counterButtonText, styles.plusText]}>+</Text>
        </Pressable>
      </View>
    </View>
  );
});

const RapidTapPanel = memo(function RapidTapPanel() {
  const [taps, setTaps] = useState(0);

  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Rapid tap target</Text>
      <Text style={styles.panelHint}>Tap this button as fast as possible. Every accepted press increments once.</Text>
      <Pressable
        accessibilityLabel="Rapid tap target"
        accessibilityRole="button"
        android_ripple={{ color: "#FFFFFF2E" }}
        onPress={() => setTaps((count) => count + 1)}
        style={({ pressed }) => [styles.tapTarget, pressed && styles.tapTargetPressed]}
      >
        <Text style={styles.tapCount}>{taps}</Text>
        <Text style={styles.tapLabel}>TAP FAST</Text>
      </Pressable>
      <View style={styles.quickActions}>
        <Pressable
          accessibilityRole="button"
          onPress={() => setTaps((count) => count + 10)}
          style={({ pressed }) => [styles.smallAction, pressed && styles.pressed]}
        >
          <Text style={styles.smallActionText}>+10</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => setTaps(0)}
          style={({ pressed }) => [styles.smallAction, pressed && styles.pressed]}
        >
          <Text style={styles.smallActionText}>Reset</Text>
        </Pressable>
      </View>
    </View>
  );
});

const MotionPanel = memo(function MotionPanel() {
  const translateX = useRef(new Animated.Value(0)).current;
  const running = useRef(false);
  const [completedRuns, setCompletedRuns] = useState(0);

  const runAnimation = useCallback(() => {
    if (running.current) return;
    running.current = true;
    translateX.setValue(0);

    Animated.sequence([
      Animated.timing(translateX, {
        toValue: 190,
        duration: 260,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(translateX, {
        toValue: 0,
        duration: 260,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      running.current = false;
      if (finished) setCompletedRuns((count) => count + 1);
    });
  }, [translateX]);

  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Native motion check</Text>
      <Text style={styles.panelHint}>The green block should travel out and back without visible frame drops.</Text>
      <View style={styles.motionTrack}>
        <Animated.View style={[styles.motionBlock, { transform: [{ translateX }] }]} />
      </View>
      <View style={styles.motionFooter}>
        <Pressable
          accessibilityRole="button"
          android_ripple={{ color: "#FFFFFF2E" }}
          onPress={runAnimation}
          style={({ pressed }) => [styles.motionButton, pressed && styles.tapTargetPressed]}
        >
          <Text style={styles.motionButtonText}>Run animation</Text>
        </Pressable>
        <Text style={styles.runCount}>Completed: {completedRuns}</Text>
      </View>
    </View>
  );
});

const ToggleRow = memo(function ToggleRow({ label, showDivider }: { label: string; showDivider: boolean }) {
  const [enabled, setEnabled] = useState(false);

  return (
    <View style={[styles.toggleRow, showDivider && styles.toggleDivider]}>
      <View>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Text style={styles.toggleState}>{enabled ? "On" : "Off"}</Text>
      </View>
      <Switch
        accessibilityLabel={`${label} local switch`}
        onValueChange={setEnabled}
        thumbColor={colors.white}
        trackColor={{ false: colors.grey400, true: colors.primary }}
        value={enabled}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },
  header: {
    backgroundColor: colors.primaryDark,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 17,
  },
  eyebrow: { color: "#DDF2CE", fontSize: 11, fontWeight: "800", letterSpacing: 1.2 },
  headerTitle: { color: colors.white, fontSize: 23, fontWeight: "800", marginTop: 3 },
  headerSubtitle: { color: "#F1F8ED", fontSize: 13, lineHeight: 18, marginTop: 4 },
  content: { padding: 12, paddingBottom: 28 },
  isolationCard: {
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: 6,
    flexDirection: "row",
    marginBottom: 10,
    padding: 12,
  },
  statusDot: { backgroundColor: colors.actionAdd, borderRadius: 6, height: 12, marginRight: 10, width: 12 },
  isolationCopy: { flex: 1 },
  isolationTitle: { color: colors.textTitle, fontSize: 15, fontWeight: "700" },
  isolationText: { color: colors.grey600, fontSize: 12, lineHeight: 17, marginTop: 2 },
  panel: { backgroundColor: colors.white, borderRadius: 6, marginBottom: 10, padding: 12 },
  panelTitle: { color: colors.textTitle, fontSize: 17, fontWeight: "800" },
  panelHint: { color: colors.grey600, fontSize: 13, lineHeight: 18, marginBottom: 10, marginTop: 2 },
  tapTarget: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 6,
    justifyContent: "center",
    minHeight: 112,
    overflow: "hidden",
  },
  tapTargetPressed: { opacity: 0.82, transform: [{ scale: 0.992 }] },
  tapCount: { color: colors.white, fontSize: 44, fontVariant: ["tabular-nums"], fontWeight: "900" },
  tapLabel: { color: "#EDF8E7", fontSize: 13, fontWeight: "800", letterSpacing: 1.4, marginTop: 1 },
  quickActions: { flexDirection: "row", justifyContent: "flex-end", marginTop: 9 },
  smallAction: {
    borderColor: colors.primary,
    borderRadius: 4,
    borderWidth: 1,
    marginLeft: 8,
    minWidth: 74,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  smallActionText: { color: colors.primaryDark, fontSize: 13, fontWeight: "700", textAlign: "center" },
  sectionHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginVertical: 10 },
  sectionHeadingCopy: { flex: 1, paddingRight: 8 },
  sectionTitle: { color: colors.grey700, fontSize: 12, fontWeight: "800", letterSpacing: 0.8 },
  sectionHint: { color: colors.grey600, fontSize: 12, marginTop: 2 },
  resetButton: {
    backgroundColor: colors.white,
    borderColor: colors.primary,
    borderRadius: 4,
    borderWidth: 1,
    overflow: "hidden",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  resetButtonText: { color: colors.primaryDark, fontSize: 13, fontWeight: "700" },
  counterGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  counterCard: {
    backgroundColor: colors.white,
    borderRadius: 6,
    marginBottom: 9,
    overflow: "hidden",
    width: "48.6%",
  },
  counterLabel: { color: colors.grey600, fontSize: 12, fontWeight: "700", paddingHorizontal: 10, paddingTop: 10 },
  counterValue: {
    color: colors.textTitle,
    fontSize: 36,
    fontVariant: ["tabular-nums"],
    fontWeight: "800",
    paddingHorizontal: 8,
    paddingVertical: 8,
    textAlign: "center",
  },
  counterActions: { borderTopColor: colors.grey200, borderTopWidth: 1, flexDirection: "row", height: 48 },
  counterButton: { alignItems: "center", flex: 1, justifyContent: "center", overflow: "hidden" },
  counterButtonText: { fontSize: 28, fontWeight: "600", includeFontPadding: false },
  minusText: { color: colors.actionRemove },
  plusText: { color: colors.actionAdd },
  counterDivider: { backgroundColor: colors.grey200, width: 1 },
  toggleHeading: { marginBottom: 8, marginTop: 5 },
  toggleCard: { backgroundColor: colors.white, borderRadius: 6, marginBottom: 10, paddingHorizontal: 12 },
  toggleRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", minHeight: 62 },
  toggleDivider: { borderBottomColor: colors.grey200, borderBottomWidth: 1 },
  toggleLabel: { color: colors.textTitle, fontSize: 15, fontWeight: "700" },
  toggleState: { color: colors.grey600, fontSize: 12, marginTop: 2 },
  motionTrack: {
    backgroundColor: colors.grey200,
    borderRadius: 20,
    height: 40,
    justifyContent: "center",
    overflow: "hidden",
    paddingHorizontal: 3,
  },
  motionBlock: { backgroundColor: colors.primary, borderRadius: 17, height: 34, width: 34 },
  motionFooter: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginTop: 10 },
  motionButton: {
    backgroundColor: colors.primary,
    borderRadius: 4,
    overflow: "hidden",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  motionButtonText: { color: colors.white, fontSize: 14, fontWeight: "800" },
  runCount: { color: colors.grey600, fontSize: 13, fontVariant: ["tabular-nums"] },
  interpretationCard: { backgroundColor: "#F2F8EE", borderColor: "#BEDAAE", borderRadius: 6, borderWidth: 1, padding: 12 },
  interpretationTitle: { color: colors.primaryDark, fontSize: 15, fontWeight: "800" },
  interpretationText: { color: colors.grey700, fontSize: 13, lineHeight: 19, marginTop: 4 },
  pressed: { opacity: 0.62 },
});
