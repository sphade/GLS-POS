/**
 * A tiny keyframe timeline for the scroll "camera".
 *
 * Scroll progress (0 → 1) is the playhead. Every animated node has a list of
 * keys; between two keys we ease, so scrolling backwards replays the film in
 * reverse for free. Only transform / opacity / clip-path are written.
 */

export type Key = { p: number; x: number; y: number; s: number; o: number };

/** Shorthand: key(progress, x, y, scale = 1, opacity = 1). */
export const k = (p: number, x: number, y: number, s = 1, o = 1): Key => ({ p, x, y, s, o });

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function sample(keys: Key[], p: number): Key {
  const first = keys[0]!;
  const last = keys[keys.length - 1]!;
  if (p <= first.p) return first;
  if (p >= last.p) return last;
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i]!;
    if (p <= b.p) {
      const a = keys[i - 1]!;
      const t = ease((p - a.p) / (b.p - a.p || 1));
      return { p, x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), s: lerp(a.s, b.s, t), o: lerp(a.o, b.o, t) };
    }
  }
  return last;
}

/** 0 → 1 across [a, b], eased; handy for one-off ramps. */
export function ramp(p: number, a: number, b: number) {
  return ease(Math.min(1, Math.max(0, (p - a) / (b - a))));
}

/** Fade in over [a, a+f], hold, fade out over [b-f, b]. */
export function hold(p: number, a: number, b: number, f = 0.02) {
  return Math.min(ramp(p, a, a + f), 1 - ramp(p, b - f, b));
}
