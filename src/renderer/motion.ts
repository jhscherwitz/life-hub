import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

// Motion helpers. Most animations live in styles.css; these handle the parts
// CSS can't do alone: playing a window's closing animation before it goes,
// and sliding widgets to their new places when the layout changes.

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** How long a window takes to slide away. Matches `.overlay.is-closing` in styles.css. */
export const CLOSE_MS = 180;

/**
 * For windows like Settings: `close()` plays the closing animation, then calls
 * `onClose`. `closing` is true meanwhile, to put `is-closing` on the overlay.
 */
export function useAnimatedClose(onClose: () => void): [closing: boolean, close: () => void] {
  const [closing, setClosing] = useState(false);
  const latest = useRef(onClose);
  latest.current = onClose;
  const started = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const close = useCallback(() => {
    if (started.current) return;
    started.current = true;
    // With reduced motion the window still fades out (the keyframes lose their movement).
    setClosing(true);
    timer.current = setTimeout(() => latest.current(), CLOSE_MS);
  }, []);
  return [closing, close];
}

/**
 * Slides children to their new places when they move ("FLIP"): after each
 * change of `key`, every child with a `data-flip` id that moved starts where it
 * was and glides to where it is now.
 */
export function useFlip(container: RefObject<HTMLElement | null>, key: unknown): void {
  const last = useRef(new Map<string, DOMRect>());
  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    const items = [...root.querySelectorAll<HTMLElement>(':scope > [data-flip]')];
    const now = new Map(items.map((el) => [el.dataset.flip!, el.getBoundingClientRect()]));
    const reduced = prefersReducedMotion();
    for (const el of items) {
      const before = last.current.get(el.dataset.flip!);
      const after = now.get(el.dataset.flip!)!;
      if (!before) continue;
      const dx = before.left - after.left;
      const dy = before.top - after.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      // Reduced motion: no sliding, but a quick fade so you can see what moved.
      el.animate(
        reduced
          ? [{ opacity: 0.35 }, { opacity: 1 }]
          : [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
        { duration: reduced ? 200 : 380, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      );
    }
    last.current = now;
  }, [container, key]);
}
