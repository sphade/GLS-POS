/**
 * GLS motion system — tiny, dependency-free.
 *
 *  - `reveal`   : one-shot entrance when an element enters the viewport
 *  - `progress` : writes scroll progress (0 → 1) to a CSS var so CSS owns the choreography
 *  - `magnetic` : CTA leans gently toward the pointer
 *
 * One shared rAF loop drives every `progress` node; nothing runs while idle.
 * `prefers-reduced-motion` disables the scroll-linked and pointer effects.
 */
import type { Action } from 'svelte/action';

export const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';

const reduced = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------------------------------------------------------------- reveal */

type RevealOpts = { delay?: number; threshold?: number } | undefined;

export const reveal: Action<HTMLElement, RevealOpts> = (node, opts) => {
  node.classList.add('rv');
  if (opts?.delay) node.style.setProperty('--rv-delay', `${opts.delay}ms`);
  if (reduced()) {
    node.classList.add('is-in');
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          node.classList.add('is-in');
          io.disconnect();
        }
      }
    },
    { threshold: opts?.threshold ?? 0.2, rootMargin: '0px 0px -8% 0px' }
  );
  io.observe(node);
  return { destroy: () => io.disconnect() };
};

/* -------------------------------------------------------------- progress */

type ProgressOpts =
  | {
      /** CSS custom property to write. Default `--p`. */
      prop?: string;
      /** 'through' = entering bottom → leaving top; 'pin' = across a tall sticky track; 'exit' = top-of-page element scrolling away. */
      mode?: 'through' | 'pin' | 'exit';
      onChange?: (p: number) => void;
    }
  | undefined;

type Entry = { node: HTMLElement; opts: NonNullable<ProgressOpts>; last: number; visible: boolean };
const entries = new Set<Entry>();
let ticking = false;

function measure() {
  ticking = false;
  const vh = window.innerHeight;
  for (const e of entries) {
    if (!e.visible) continue;
    const r = e.node.getBoundingClientRect();
    let p: number;
    if (e.opts.mode === 'pin') {
      const span = r.height - vh;
      p = span > 0 ? -r.top / span : 0;
    } else if (e.opts.mode === 'exit') {
      p = -r.top / r.height;
    } else {
      p = (vh - r.top) / (vh + r.height);
    }
    p = Math.min(1, Math.max(0, p));
    if (Math.abs(p - e.last) > 0.0005) {
      e.last = p;
      e.node.style.setProperty(e.opts.prop ?? '--p', p.toFixed(4));
      e.opts.onChange?.(p);
    }
  }
}
function schedule() {
  if (!ticking) {
    ticking = true;
    requestAnimationFrame(measure);
  }
}
let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', schedule, { passive: true });
}

export const progress: Action<HTMLElement, ProgressOpts> = (node, opts) => {
  const entry: Entry = { node, opts: opts ?? {}, last: -1, visible: true };
  if (reduced()) {
    const rest = entry.opts.mode === 'through' || !entry.opts.mode ? 0.5 : 0;
    node.style.setProperty(entry.opts.prop ?? '--p', String(rest));
    entry.opts.onChange?.(rest);
    return;
  }
  entries.add(entry);
  listen();
  // Only measure nodes that are near the viewport.
  const io = new IntersectionObserver(
    ([e]) => {
      entry.visible = !!e?.isIntersecting;
      schedule();
    },
    { rootMargin: '25% 0px 25% 0px' }
  );
  io.observe(node);
  schedule();
  return {
    destroy() {
      io.disconnect();
      entries.delete(entry);
    }
  };
};

/* -------------------------------------------------------------- magnetic */

export const magnetic: Action<HTMLElement, number | undefined> = (node, strength = 0.28) => {
  if (reduced() || !matchMedia('(hover: hover)').matches) return;
  let raf = 0;
  const move = (ev: PointerEvent) => {
    const r = node.getBoundingClientRect();
    const x = (ev.clientX - (r.left + r.width / 2)) * strength;
    const y = (ev.clientY - (r.top + r.height / 2)) * strength;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => (node.style.translate = `${x}px ${y}px`));
  };
  const leave = () => {
    cancelAnimationFrame(raf);
    node.style.translate = '0px 0px';
  };
  node.style.transition = `translate 600ms ${EASE_OUT}`;
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerleave', leave);
  return {
    destroy() {
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerleave', leave);
    }
  };
};
