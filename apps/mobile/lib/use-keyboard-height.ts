import { useKeyboardHandler } from "react-native-keyboard-controller";
import { useSharedValue } from "react-native-reanimated";

/**
 * Hook for tracking keyboard height changes using shared values for animation.
 * Returns a shared value that updates as the keyboard opens/closes.
 *
 * @example
 * const { height } = useKeyboardHeight();
 * return (
 *   <Animated.View style={[{ height }]}>
 *     <Text>Keyboard spacer</Text>
 *   </Animated.View>
 * );
 */
export function useKeyboardHeight() {
  const height = useSharedValue(0);

  useKeyboardHandler({
    onMove: (event) => {
      "worklet";
      height.value = Math.max(event.height, 0);
    },
  });

  return { height };
}
