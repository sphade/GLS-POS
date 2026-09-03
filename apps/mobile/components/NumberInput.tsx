import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { TextInput, type TextInputProps } from "react-native";

/**
 * Number entry that highlights whatever is already there when you tap in.
 *
 * Editing stock or a price almost always means replacing the number rather than
 * appending to it. With a plain TextInput, tapping a field showing "10" drops a
 * caret wherever your finger landed, so typing "24" can produce "1024" — you
 * have to clear it by hand first. Here the first tap selects the whole value, so
 * the next keystroke overwrites it.
 *
 * Tapping again while the field is already focused places the caret normally, so
 * a small edit ("12" → "120") is still possible. `onFocus` only fires when the
 * field *gains* focus, which is what makes that work.
 *
 * `selectTextOnFocus` alone is unreliable on Android — it can highlight and then
 * immediately collapse the selection — so the range is also set explicitly for
 * one frame and then released, which hands the caret back to the user.
 *
 * Forwards its ref to the underlying TextInput so a wrapper can focus it — see
 * FieldCard, where tapping anywhere on the card puts the cursor in the field.
 */
export const NumberInput = forwardRef<
  TextInput,
  Omit<TextInputProps, "onChangeText" | "keyboardType" | "value"> & {
    value: string;
    onChangeText: (text: string) => void;
    /** Allow a decimal point. False keeps it to whole numbers. */
    decimals?: boolean;
  }
>(function NumberInput({ value, onChangeText, decimals = true, onFocus, onBlur, ...rest }, ref) {
  const [selection, setSelection] = useState<{ start: number; end: number } | undefined>();
  /**
   * Exactly what's been typed, kept only while the field is focused.
   *
   * Several callers store money as minor units and hand back a value derived
   * from it, so "5." round-trips to "5" and the decimal point vanishes as you
   * type — making 5.50 impossible to enter. Holding the raw text during editing
   * fixes that everywhere at once; on blur the field falls back to the caller's
   * canonical value, so any clamping still shows up.
   */
  const [draft, setDraft] = useState<string | null>(null);
  const release = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shown = draft ?? value;

  useEffect(
    () => () => {
      if (release.current) clearTimeout(release.current);
    },
    [],
  );

  const handleFocus = useCallback<NonNullable<TextInputProps["onFocus"]>>(
    (event) => {
      onFocus?.(event);
      const length = (draft ?? value).length;
      if (length === 0) return;
      setSelection({ start: 0, end: length });
      // Give the caret straight back so the highlight is a starting point, not
      // a mode the field is stuck in.
      if (release.current) clearTimeout(release.current);
      release.current = setTimeout(() => setSelection(undefined), 0);
    },
    [draft, onFocus, value],
  );

  return (
    <TextInput
      ref={ref}
      {...rest}
      value={shown}
      selectTextOnFocus
      selection={selection}
      onFocus={handleFocus}
      onBlur={(event) => {
        setDraft(null);
        setSelection(undefined);
        onBlur?.(event);
      }}
      onChangeText={(text) => {
        setSelection(undefined);
        const clean = sanitizeNumeric(text, decimals);
        setDraft(clean);
        onChangeText(clean);
      }}
      keyboardType={decimals ? "decimal-pad" : "number-pad"}
    />
  );
});

/**
 * Strip anything that isn't a number. Without this a stray character silently
 * parses to 0, which for a low-stock alert means "warn me at 0" — an alert that
 * never fires.
 */
export function sanitizeNumeric(text: string, decimals: boolean): string {
  if (!decimals) return text.replace(/[^0-9]/g, "");
  const cleaned = text.replace(/[^0-9.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot === -1) return cleaned;
  // Keep only the first decimal point.
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");
}
