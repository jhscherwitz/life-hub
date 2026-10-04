import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { moveWidget, type PlacedWidget, type WidgetType } from '../../shared/layout';
import { prefersReducedMotion } from '../motion';

/** How far the pointer moves before a press becomes a drag, so clicks stay clicks. */
const START_PX = 5;
/** Near the top or bottom of the window, the page scrolls by itself. */
const EDGE_PX = 80;
const MAX_SCROLL = 18;
/** After two widgets swap, wait a moment so they don't swap straight back as they slide. */
const SWAP_PAUSE_MS = 220;

interface Drag {
  type: WidgetType;
  el: HTMLElement;
  startX: number;
  startY: number;
  x: number;
  y: number;
  ghost: HTMLElement | null;
  lastSwap: WidgetType | null;
  pausedUntil: number;
}

/**
 * Moving widgets with the mouse: press and drag a widget, a copy follows the
 * pointer, and the others slide out of its way. The page scrolls when you
 * drag near the edge. The layout is saved once, when you let go.
 */
export function useWidgetDrag({
  grid,
  layout,
  preview,
  save,
}: {
  grid: RefObject<HTMLDivElement | null>;
  layout: PlacedWidget[];
  /** Shows a new order while dragging, without saving it. */
  preview: (next: PlacedWidget[]) => void;
  save: (next: PlacedWidget[]) => void;
}) {
  const [dragging, setDragging] = useState<WidgetType | null>(null);
  const drag = useRef<Drag | null>(null);
  const latest = useRef(layout);
  latest.current = layout;
  const frame = useRef(0);

  // Stop cleanly if the page goes away mid-drag.
  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      drag.current?.ghost?.remove();
      document.body.classList.remove('is-dragging-widget');
    },
    [],
  );

  const hitTest = (d: Drag) => {
    if (performance.now() < d.pausedUntil) return;
    const under = document.elementFromPoint(d.x, d.y)?.closest<HTMLElement>('[data-flip]');
    const over = under && grid.current?.contains(under) ? (under.dataset.flip as WidgetType) : null;
    if (!over || over === d.type) {
      d.lastSwap = null;
      return;
    }
    if (over === d.lastSwap) return;
    const next = moveWidget(latest.current, d.type, over);
    if (next === latest.current) return;
    d.lastSwap = over;
    d.pausedUntil = performance.now() + SWAP_PAUSE_MS;
    latest.current = next;
    preview(next);
  };

  // While dragging: scroll near the edges, and keep checking what's under the pointer as the page moves.
  const tick = () => {
    const d = drag.current;
    if (!d?.ghost) return;
    const top = d.y - EDGE_PX;
    const bottom = d.y - (window.innerHeight - EDGE_PX);
    const speed = top < 0 ? Math.max(-MAX_SCROLL, top / 4) : bottom > 0 ? Math.min(MAX_SCROLL, bottom / 4) : 0;
    // The page scrolls inside its column, not the window.
    if (speed) (grid.current?.closest('.main') ?? document.scrollingElement)?.scrollBy(0, speed);
    hitTest(d);
    frame.current = requestAnimationFrame(tick);
  };

  const begin = (d: Drag) => {
    const rect = d.el.getBoundingClientRect();
    const ghost = d.el.cloneNode(true) as HTMLElement;
    ghost.classList.add('widget-ghost');
    ghost.removeAttribute('data-flip');
    Object.assign(ghost.style, {
      position: 'fixed',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      margin: '0',
      zIndex: '60',
      pointerEvents: 'none',
    });
    document.body.appendChild(ghost);
    d.ghost = ghost;
    document.body.classList.add('is-dragging-widget');
    setDragging(d.type);
    frame.current = requestAnimationFrame(tick);
  };

  /** The copy follows the pointer from where it was picked up. */
  const place = (d: Drag) => {
    if (d.ghost) d.ghost.style.transform = `translate(${d.x - d.startX}px, ${d.y - d.startY}px) rotate(1.2deg) scale(1.03)`;
  };

  const end = (keep: boolean) => {
    const d = drag.current;
    drag.current = null;
    cancelAnimationFrame(frame.current);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    document.body.classList.remove('is-dragging-widget');
    if (!d?.ghost) return;
    if (keep) save(latest.current);
    // The copy settles into the widget's new spot, then goes.
    const ghost = d.ghost;
    const to = d.el.getBoundingClientRect();
    const left = parseFloat(ghost.style.left);
    const top = parseFloat(ghost.style.top);
    const done = () => {
      ghost.remove();
      setDragging(null);
    };
    if (prefersReducedMotion()) return done();
    ghost.style.transition = 'transform 220ms cubic-bezier(0.2, 0.9, 0.25, 1)';
    ghost.style.transform = `translate(${to.left - left}px, ${to.top - top}px)`;
    setTimeout(done, 230);
  };

  function onMove(e: PointerEvent) {
    const d = drag.current;
    if (!d) return;
    d.x = e.clientX;
    d.y = e.clientY;
    if (!d.ghost) {
      if (Math.hypot(d.x - d.startX, d.y - d.startY) < START_PX) return;
      begin(d);
    }
    e.preventDefault();
    place(d);
    hitTest(d);
  }
  function onUp() {
    end(true);
  }
  function onCancel() {
    end(true);
  }

  /** Put on each widget while editing. */
  const onPointerDown = (e: ReactPointerEvent<HTMLElement>, type: WidgetType) => {
    if (e.button !== 0 || drag.current) return;
    // The widget's own buttons (size, look, remove) still work.
    if ((e.target as HTMLElement).closest('button, input, select, textarea, a')) return;
    e.preventDefault();
    const el = e.currentTarget;
    drag.current = {
      type,
      el,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      ghost: null,
      lastSwap: null,
      pausedUntil: 0,
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  };

  return { dragging, onPointerDown };
}
