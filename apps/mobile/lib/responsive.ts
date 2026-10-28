import { useWindowDimensions } from "react-native";

/**
 * Screen-size helpers for phones *and* the large Android POS terminals the app
 * also runs on.
 *
 * The app was designed phone-first, which is still the common case: a cashier
 * holding a 5.5" handset. On a 10-15" till the same full-bleed layout looks
 * stretched — one metric card spanning 1280px, form fields a metre wide, a
 * three-column item grid with dinner-plate tiles. These breakpoints let a
 * screen opt into a wider layout without forking the UI.
 *
 * Sizes are based on the *window* width, so a tablet in split-screen behaves
 * like the pane it is actually rendered in.
 */
export const BREAKPOINTS = {
  /** Phones. One-column forms, 2-3 item tiles per row. */
  compact: 0,
  /** Small tablets / large phones in landscape. */
  medium: 600,
  /** Full-size tablets and POS terminals. */
  expanded: 960,
  /** Very wide counters; content stops growing beyond this. */
  wide: 1280,
} as const;

export type ScreenClass = "compact" | "medium" | "expanded";

export type Responsive = {
  width: number;
  height: number;
  screen: ScreenClass;
  isCompact: boolean;
  isMedium: boolean;
  isExpanded: boolean;
  /**
   * Width readable content should occupy. Full window on phones, capped and
   * centred on large screens so text lines and cards stay scannable.
   */
  contentWidth: number;
  /** Narrower column for forms, checkout and single-column reading. */
  formWidth: number;
  /** Page gutter; grows slightly with the screen. */
  gutter: number;
  /** Comfortable tile count for a card grid, given a minimum tile width. */
  gridColumns: (minTile?: number, max?: number) => number;
};

export function useResponsive(): Responsive {
  const { width, height } = useWindowDimensions();

  const isExpanded = width >= BREAKPOINTS.expanded;
  const isMedium = width >= BREAKPOINTS.medium && !isExpanded;
  const isCompact = !isExpanded && !isMedium;

  const contentWidth = Math.min(width, BREAKPOINTS.wide);
  const formWidth = Math.min(width, 760);
  const gutter = isExpanded ? 16 : 8;

  const gridColumns = (minTile = 160, max = 8) => {
    const usable = contentWidth - gutter * 2;
    return Math.max(2, Math.min(max, Math.floor(usable / minTile)));
  };

  return {
    width,
    height,
    screen: isExpanded ? "expanded" : isMedium ? "medium" : "compact",
    isCompact,
    isMedium,
    isExpanded,
    contentWidth,
    formWidth,
    gutter,
    gridColumns,
  };
}

/**
 * Static equivalents for places that can't call a hook (StyleSheet defaults).
 * They deliberately match the phone layout so nothing changes on a handset.
 */
export const CONTENT_MAX_WIDTH = BREAKPOINTS.wide;
export const FORM_MAX_WIDTH = 760;

/** Content container that stays centred and readable on a wide till. */
export const centeredContent = {
  width: "100%",
  maxWidth: CONTENT_MAX_WIDTH,
  alignSelf: "center",
} as const;

/** Narrower variant for forms, checkout and single-column reading. */
export const centeredForm = {
  width: "100%",
  maxWidth: FORM_MAX_WIDTH,
  alignSelf: "center",
} as const;
