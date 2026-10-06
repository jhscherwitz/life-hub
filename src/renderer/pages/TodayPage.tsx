import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  DEFAULT_LAYOUT,
  STARTER_LAYOUTS,
  widgetProblem,
  widgetTier,
  SIZE_COLUMNS,
  WIDGETS,
  addWidget,
  nextWidgetStyle,
  normalizeLayout,
  removeWidget,
  resizeWidget,
  heightsFor,
  rowsFor,
  setWidgetRows,
  type PlacedWidget,
  type WidgetType,
} from '../../shared/layout';
import { Icon } from '../components/Icon';
import { localIsoDate } from '../../shared/time';
import { WIDGET_VIEWS, type WidgetContext } from '../components/widgets';
import { SIZE_NAMES, WidgetPicker } from '../components/WidgetPicker';
import { prefersReducedMotion, useFlip } from '../motion';
import { useWidgetDrag } from './useWidgetDrag';

/** The saved layout, loaded from Life Hub and saved back on every change. */
function useLayout(): [PlacedWidget[], (next: PlacedWidget[]) => void, (next: PlacedWidget[]) => void] {
  const [layout, setLayout] = useState<PlacedWidget[]>(() => normalizeLayout(undefined));
  useEffect(() => {
    // Missing when the screen updated but the rest of Life Hub is still the old version.
    if (!window.hub.getLayout) return;
    void window.hub.getLayout().then(setLayout);
    // Chat can rearrange the widgets too.
    return window.hub.onLayoutChanged?.(() => void window.hub.getLayout().then(setLayout));
  }, []);
  const save = (next: PlacedWidget[]) => {
    setLayout(next);
    if (window.hub.saveLayout) void window.hub.saveLayout(next);
  };
  return [layout, save, setLayout];
}

/** The home page: a grid of widgets that each person arranges for themselves. */
export function TodayPage({ ctx, editing, onDoneEditing }: { ctx: WidgetContext; editing: boolean; onDoneEditing: () => void }) {
  const [layout, setLayout, previewLayout] = useLayout();
  const [picking, setPicking] = useState(false);
  // The last remove or reset can be undone for a few seconds.
  const [undo, setUndo] = useState<{ text: string; layout: PlacedWidget[] } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [confirmReset, setConfirmReset] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(
    () => () => {
      clearTimeout(undoTimer.current);
      clearTimeout(resetTimer.current);
    },
    [],
  );
  const offerUndo = (text: string, before: PlacedWidget[]) => {
    clearTimeout(undoTimer.current);
    setUndo({ text, layout: before });
    undoTimer.current = setTimeout(() => setUndo(null), 8000);
  };
  const failed = ctx.snapshot.sources.filter((src) => !src.ok);
  // Widgets just added pop in; ones being removed shrink away first.
  const [fresh, setFresh] = useState<WidgetType | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const widgetEl = (type: WidgetType) => grid.current?.querySelector<HTMLElement>(`[data-flip="${type}"]`) ?? null;
  useFlip(grid, layout);
  const { dragging, onPointerDown } = useWidgetDrag({ grid, layout, preview: previewLayout, save: setLayout });
  // The newest layout, for removing after the animation.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  useEffect(() => {
    if (!fresh) return;
    const el = widgetEl(fresh);
    setFresh(null);
    if (!el) return;
    const still = prefersReducedMotion();
    el.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'nearest' });
    if (still) return;
    el.animate(
      [
        { opacity: 0, transform: 'scale(0.82)' },
        { opacity: 1, transform: 'scale(1.03)', offset: 0.6 },
        { opacity: 1, transform: 'scale(1)' },
      ],
      { duration: 520, easing: 'cubic-bezier(0.2, 0.9, 0.25, 1)' },
    );
  }, [fresh]);

  const remove = (type: WidgetType) => {
    offerUndo(`Removed ${WIDGETS[type].title}`, layoutRef.current);
    const el = widgetEl(type);
    if (!el || prefersReducedMotion()) return setLayout(removeWidget(layout, type));
    el.style.pointerEvents = 'none';
    el.animate(
      [
        { opacity: 1, transform: 'scale(1)' },
        { opacity: 0, transform: 'scale(0.8)' },
      ],
      {
        duration: 200,
        easing: 'cubic-bezier(0.4, 0, 1, 1)',
        fill: 'forwards',
      },
    ).onfinish = () => setLayout(removeWidget(layoutRef.current, type));
  };

  return (
    <>
      {editing && (
        <div className="edit-bar">
          <span>Drag a widget to move it. Pick how wide or tall it is, or ✕ to remove it. A remove can be undone.</span>
          <button className="button" onClick={() => setPicking(true)}>
            <Icon name="plus" size={14} /> Add widget
          </button>
          <button
            className={`button ${confirmReset ? 'button-danger' : ''}`}
            onClick={() => {
              if (!confirmReset) {
                setConfirmReset(true);
                clearTimeout(resetTimer.current);
                resetTimer.current = setTimeout(() => setConfirmReset(false), 4000);
                return;
              }
              clearTimeout(resetTimer.current);
              setConfirmReset(false);
              offerUndo('Page reset to the starting layout', layout);
              setLayout(DEFAULT_LAYOUT.map((w) => ({ ...w })));
            }}
          >
            {confirmReset ? 'Click again to reset' : 'Reset'}
          </button>
          <button className="button button-primary" onClick={onDoneEditing}>
            Done
          </button>
        </div>
      )}

      <div ref={grid} className={`widgets ${editing ? 'is-editing' : ''}`}>
        {layout.map((w, i) => {
          const View = WIDGET_VIEWS[w.type];
          return (
            <div
              key={w.type}
              className={`widget ${dragging === w.type ? 'is-dragging' : ''}`}
              data-size={w.size}
              data-tier={widgetTier(w.type)}
              data-flip={w.type}
              data-rows={rowsFor(w.type, w.size, w.rows)}
              style={{ gridColumn: `span ${SIZE_COLUMNS[w.size]}`, gridRow: `span ${rowsFor(w.type, w.size, w.rows)}`, ['--i' as string]: i } as CSSProperties}
              onPointerDown={editing ? (e) => onPointerDown(e, w.type) : undefined}
            >
              <View {...ctx} size={w.size} rows={rowsFor(w.type, w.size, w.rows)} style={w.style} />
              {!editing && widgetProblem(w.type, failed) && (
                <span className="widget-alert" title={widgetProblem(w.type, failed)!} role="img" aria-label={widgetProblem(w.type, failed)!}>
                  <Icon name="alert" size={12} />
                </span>
              )}
              {editing && (
                <div className="widget-edit">
                  <span className="widget-grip" title="Drag to move">
                    <Icon name="grip" size={16} />
                    {WIDGETS[w.type].title}
                  </span>
                  {WIDGETS[w.type].styles && (
                    <button className="widget-style" title="Change the look" onClick={() => setLayout(nextWidgetStyle(layout, w.type))}>
                      {(WIDGETS[w.type].styles!.find((s) => s.id === w.style) ?? WIDGETS[w.type].styles![0]).label}
                    </button>
                  )}
                  {WIDGETS[w.type].sizes.length > 1 && (
                    <span className="widget-sizes">
                      {WIDGETS[w.type].sizes.map((size) => (
                        <button
                          key={size}
                          className={size === w.size ? 'is-on' : ''}
                          title={`${SIZE_NAMES[size]} width`}
                          aria-label={`${SIZE_NAMES[size]} width`}
                          aria-pressed={size === w.size}
                          onClick={() => setLayout(resizeWidget(layout, w.type, size))}
                        >
                          <i className="size-glyph" style={{ width: 4 + SIZE_COLUMNS[size] * 0.6 }} aria-hidden="true" />
                        </button>
                      ))}
                    </span>
                  )}
                  {heightsFor(w.type, w.size).length > 1 && (
                    <span className="widget-sizes widget-heights" title="How tall">
                      <Icon name="height" size={12} />
                      {heightsFor(w.type, w.size).map((rows) => (
                        <button
                          key={rows}
                          className={rows === rowsFor(w.type, w.size, w.rows) ? 'is-on' : ''}
                          title={`${rows} row${rows === 1 ? '' : 's'} tall`}
                          aria-label={`${rows} row${rows === 1 ? '' : 's'} tall`}
                          aria-pressed={rows === rowsFor(w.type, w.size, w.rows)}
                          onClick={() => setLayout(setWidgetRows(layout, w.type, rows))}
                        >
                          {rows}
                        </button>
                      ))}
                    </span>
                  )}
                  <button className="widget-remove" title="Remove (you can undo)" aria-label={`Remove ${WIDGETS[w.type].title}`} onClick={() => remove(w.type)}>
                    <Icon name="x" size={14} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {layout.length === 0 && (
          <div className="card empty-page">
            <p>Your page is empty. Start from a layout, or add widgets one at a time.</p>
            <div className="empty-starters">
              {(Object.keys(STARTER_LAYOUTS) as (keyof typeof STARTER_LAYOUTS)[]).map((id) => (
                <button key={id} className="button" onClick={() => setLayout(STARTER_LAYOUTS[id].layout.map((w) => ({ ...w })))}>
                  <strong>{STARTER_LAYOUTS[id].label}</strong>
                  <span className="muted small">{STARTER_LAYOUTS[id].blurb}</span>
                </button>
              ))}
            </div>
            <button className="button button-primary" onClick={() => setPicking(true)}>
              <Icon name="plus" size={14} /> Add a widget
            </button>
          </div>
        )}
      </div>

      {!editing && layout.length > 0 && <AllClear ctx={ctx} />}

      {undo && (
        <div className="undo-toast" role="status">
          <span>{undo.text}</span>
          <button
            className="link-button"
            onClick={() => {
              clearTimeout(undoTimer.current);
              setLayout(undo.layout);
              setUndo(null);
            }}
          >
            Undo
          </button>
        </div>
      )}

      {picking && (
        <WidgetPicker
          layout={layout}
          ctx={ctx}
          onAdd={(type, size) => {
            setLayout(addWidget(layout, type, size));
            setFresh(type);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}

/** The closing line of the page: when nothing needs you, it says so and says what's next. */
function AllClear({ ctx }: { ctx: WidgetContext }) {
  const { snapshot, now } = ctx;
  const today = localIsoDate(new Date(now));
  const waiting = snapshot.emails.filter((e) => e.needsReply).length;
  const due = snapshot.tasks.filter((t) => !t.done && t.due && t.due.slice(0, 10) <= today).length;
  const left = snapshot.events.filter((e) => localIsoDate(new Date(e.start)) === today && new Date(e.end).getTime() > now).length;
  if (waiting + due + left > 0) return null;
  const next = snapshot.events.filter((e) => new Date(e.start).getTime() > now).sort((a, b) => a.start.localeCompare(b.start))[0];
  return (
    <p className="all-clear">
      <Icon name="check" size={15} />
      <span>
        You're clear for now. Nothing waiting, nothing due, no more meetings today.
        {next && (
          <span className="muted">
            {' '}
            Next: {next.title}, {new Date(next.start).toLocaleDateString([], { weekday: 'short' })} {new Date(next.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.
          </span>
        )}
      </span>
    </p>
  );
}

/** What shows while the day loads: the starting layout as quiet placeholder cards. */
export function TodaySkeleton() {
  return (
    <div className="widgets is-loading" role="status" aria-busy="true">
      <span className="sr-only">Loading your day…</span>
      {DEFAULT_LAYOUT.map((w) => (
        <div
          key={w.type}
          className="widget"
          style={{ gridColumn: `span ${SIZE_COLUMNS[w.size]}`, gridRow: `span ${rowsFor(w.type, w.size, w.rows)}`, ['--i' as string]: 0 } as CSSProperties}
        >
          <div className="card skeleton" aria-hidden="true" />
        </div>
      ))}
    </div>
  );
}
