import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  DEFAULT_LAYOUT,
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
          <span>Drag widgets to move them. Pick a width, a height (↕), or ✕ to remove one.</span>
          <button className="button" onClick={() => setPicking(true)}>
            <Icon name="plus" size={14} /> Add widget
          </button>
          <button className="button" onClick={() => setLayout(DEFAULT_LAYOUT.map((w) => ({ ...w })))}>
            Reset
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
              data-flip={w.type}
              data-rows={rowsFor(w.type, w.size, w.rows)}
              style={{ gridColumn: `span ${SIZE_COLUMNS[w.size]}`, gridRow: `span ${rowsFor(w.type, w.size, w.rows)}`, ['--i' as string]: i } as CSSProperties}
              onPointerDown={editing ? (e) => onPointerDown(e, w.type) : undefined}
            >
              <View {...ctx} size={w.size} rows={rowsFor(w.type, w.size, w.rows)} style={w.style} />
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
                          title={SIZE_NAMES[size]}
                          onClick={() => setLayout(resizeWidget(layout, w.type, size))}
                        >
                          {size.toUpperCase()}
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
                          onClick={() => setLayout(setWidgetRows(layout, w.type, rows))}
                        >
                          {rows}
                        </button>
                      ))}
                    </span>
                  )}
                  <button className="widget-remove" title="Remove" aria-label={`Remove ${WIDGETS[w.type].title}`} onClick={() => remove(w.type)}>
                    <Icon name="x" size={14} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {layout.length === 0 && (
          <div className="card empty-page">
            <p>Your page is empty.</p>
            <button className="button button-primary" onClick={() => setPicking(true)}>
              <Icon name="plus" size={14} /> Add a widget
            </button>
          </div>
        )}
      </div>

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
