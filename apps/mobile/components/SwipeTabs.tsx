import { useRef, useState, type ReactNode } from "react";
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { colors } from "@/constants/theme";
import { feedbackTap } from "@/lib/feedback";

/**
 * Tab pager that is both tappable and swipeable, with an underline indicator.
 * Used by the report drill-down, take-order, and the inventory hub.
 */
export function SwipeTabs({
  tabs,
  initialIndex = 0,
  scrollableTabs = false,
  renderPage,
  onIndexChange,
}: {
  tabs: string[];
  initialIndex?: number;
  /** Horizontally scroll the tab strip (for many/long tabs). */
  scrollableTabs?: boolean;
  renderPage: (index: number) => ReactNode;
  onIndexChange?: (index: number) => void;
}) {
  const { width } = useWindowDimensions();
  const pagerRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(initialIndex);

  const setPage = (i: number) => {
    const next = Math.max(0, Math.min(tabs.length - 1, i));
    setIndex(next);
    onIndexChange?.(next);
  };

  const goTo = (i: number) => {
    feedbackTap();
    setPage(i);
    pagerRef.current?.scrollTo({ x: i * width, animated: true });
  };

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    if (i !== index) {
      feedbackTap();
      setPage(i);
    }
  };

  const strip = (
    <View style={[styles.strip, !scrollableTabs && { flex: 1 }]}>
      {tabs.map((t, i) => (
        <Pressable
          key={t}
          style={[styles.tab, !scrollableTabs && { flex: 1 }, scrollableTabs && { paddingHorizontal: 18 }]}
          onPress={() => goTo(i)}
        >
          <Text style={[styles.tabText, index === i && styles.tabTextActive]} numberOfLines={1}>
            {t}
          </Text>
          {index === i && <View style={styles.indicator} />}
        </Pressable>
      ))}
    </View>
  );

  return (
    <>
      {scrollableTabs ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.stripScroll}>
          {strip}
        </ScrollView>
      ) : (
        <View style={styles.stripWrap}>{strip}</View>
      )}

      <ScrollView
        ref={pagerRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumEnd}
        contentOffset={{ x: initialIndex * width, y: 0 }}
        style={{ flex: 1 }}
      >
        {tabs.map((t, i) => (
          <View key={t} style={{ width }}>
            {renderPage(i)}
          </View>
        ))}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  stripWrap: { backgroundColor: colors.white },
  stripScroll: { maxHeight: 46, backgroundColor: colors.white },
  strip: { flexDirection: "row", backgroundColor: colors.white },
  tab: { height: 46, alignItems: "center", justifyContent: "center" },
  tabText: { fontSize: 14, fontWeight: "600", color: colors.grey500, letterSpacing: 0.3 },
  tabTextActive: { color: colors.grey900, fontWeight: "700" },
  indicator: { position: "absolute", bottom: 0, left: 10, right: 10, height: 3, backgroundColor: colors.primary },
});
