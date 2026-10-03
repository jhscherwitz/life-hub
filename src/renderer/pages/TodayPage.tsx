import { useEffect, useState } from 'react';
import {
  DEFAULT_LAYOUT,
  SIZE_COLUMNS,
  WIDGETS,
  addWidget,
  availableWidgets,
  moveWidget,
  normalizeLayout,
  removeWidget,
  resizeWidget,
  type PlacedWidget,
  type WidgetSize,
  type WidgetType,
} from '../../shared/layout';
import { Icon } from '../components/Icon';
import { WIDGET_VIEWS, type WidgetContext } from '../components/widgets';

const SIZE_NAMES: Record<WidgetSize, string> = { s: 'Small', m: 'Medium', w: 'Wide', f: 'Full width' };

/** The saved layout, loaded from Life Hub and saved back on every change. */
function useLayout(): [PlacedWidget[], (next: PlacedWidget[]) => void] {
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
  return [layout, save];
}

function WidgetPicker({ layout, onAdd, onClose }: { layout: PlacedWidget[]; onAdd: (type: WidgetType) => void; onClose: () => void }) {
  const choices = availableWidgets(layout);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="settings picker" role="dialog" aria-label="Add a widget">
        <header className="card-header">
          <h2>Add a widget</h2>
          <button className="button" onClick={onClose}>
            Done
          </button>
        </header>
        {choices.length === 0 ? (
          <p className="muted">Every widget is already on your page.</p>
        ) : (
          <ul className="picker-list">
            {choices.map((type) => (
              <li key={type}>
                <button className="picker-item" onClick={() => onAdd(type)}>
                  <span>
                    <strong>{WIDGETS[type].title}</strong>
                    <span className="muted">{WIDGETS[type].description}</span>
                  </span>
                  <Icon name="plus" size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** The home page: a grid of widgets that each person arranges for themselves. */
export function TodayPage({ ctx, editing, onDoneEditing }: { ctx: WidgetContext; editing: boolean; onDoneEditing: () => void }) {
  const [layout, setLayout] = useLayout();
  const [dragging, setDragging] = useState<WidgetType | null>(null);
  const [picking, setPicking] = useState(false);

  return (
    <>
      {editing && (
        <div className="edit-bar">
          <span>Drag widgets to move them. Pick a size, or ✕ to remove one.</span>
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

      <div className={`widgets ${editing ? 'is-editing' : ''}`}>
        {layout.map((w) => {
          const View = WIDGET_VIEWS[w.type];
          return (
            <div
              key={w.type}
              className={`widget ${dragging === w.type ? 'is-dragging' : ''}`}
              data-size={w.size}
              style={{ gridColumn: `span ${SIZE_COLUMNS[w.size]}`, gridRow: `span ${WIDGETS[w.type].rows}` }}
              draggable={editing}
              onDragStart={(e) => {
                setDragging(w.type);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={() => setDragging(null)}
              onDragOver={(e) => {
                if (!dragging) return;
                e.preventDefault();
                if (dragging !== w.type) setLayout(moveWidget(layout, dragging, w.type));
              }}
              onDrop={(e) => e.preventDefault()}
            >
              <View {...ctx} />
              {editing && (
                <div className="widget-edit">
                  <span className="widget-grip" title="Drag to move">
                    <Icon name="grip" size={16} />
                    {WIDGETS[w.type].title}
                  </span>
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
                  <button className="widget-remove" title="Remove" aria-label={`Remove ${WIDGETS[w.type].title}`} onClick={() => setLayout(removeWidget(layout, w.type))}>
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
          onAdd={(type) => setLayout(addWidget(layout, type))}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}
