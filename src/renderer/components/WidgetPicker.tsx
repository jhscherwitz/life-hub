import { useEffect, useState, type CSSProperties } from 'react';
import { useAnimatedClose } from '../motion';
import { SIZE_COLUMNS, WIDGETS, availableWidgets, rowsFor, widgetBox, type PlacedWidget, type WidgetSize, type WidgetType } from '../../shared/layout';
import { Icon } from './Icon';
import { WIDGET_VIEWS, type WidgetContext } from './widgets';

export const SIZE_NAMES: Record<WidgetSize, string> = { xs: 'Tiny', s: 'Small', m: 'Medium', w: 'Wide', f: 'Full width' };
const SIZE_SHARE: Record<WidgetSize, string> = { xs: 'Square', s: '¼ row', m: '½ row', w: '¾ row', f: 'Full row' };

/**
 * The widget drawn exactly as it would be on the page (same pixel size, real
 * data), then shrunk to fit the box. It can't be clicked.
 */
function Preview({
  type,
  size,
  ctx,
  gridWidth,
  box,
}: {
  type: WidgetType;
  size: WidgetSize;
  ctx: WidgetContext;
  gridWidth: number;
  box: { w: number; h: number };
}) {
  const View = WIDGET_VIEWS[type];
  const real = widgetBox(size, rowsFor(type, size), gridWidth);
  const scale = Math.min(1, box.w / real.width, box.h / real.height);
  return (
    <div className="preview" style={{ width: real.width * scale, height: real.height * scale }} aria-hidden="true">
      <div className="preview-inner widget" data-size={size} style={{ width: real.width, height: real.height, transform: `scale(${scale})` }} inert>
        <View {...ctx} size={size} />
      </div>
    </div>
  );
}

/** A tiny map of two rows of eight squares, with this size's share filled in. */
function SizeMap({ size, rows }: { size: WidgetSize; rows: number }) {
  const cols = SIZE_COLUMNS[size] / 3;
  return (
    <span className="size-map" aria-hidden="true">
      {Array.from({ length: 16 }, (_, i) => (
        <i key={i} className={i % 8 < cols && Math.floor(i / 8) < rows ? 'is-on' : ''} />
      ))}
    </span>
  );
}

function SizeChooser({
  type,
  ctx,
  gridWidth,
  onAdd,
  onBack,
}: {
  type: WidgetType;
  ctx: WidgetContext;
  gridWidth: number;
  onAdd: (size: WidgetSize) => void;
  onBack: () => void;
}) {
  const info = WIDGETS[type];
  const [size, setSize] = useState<WidgetSize>(info.defaultSize);
  return (
    <>
      <header className="card-header picker-head">
        <button className="icon-button" onClick={onBack} aria-label="Back to all widgets" title="Back">
          <Icon name="back" size={15} />
        </button>
        <div>
          <h2>{info.title}</h2>
          <p className="muted small">{info.description}</p>
        </div>
      </header>

      <div className="size-tabs" role="radiogroup" aria-label="Size">
        {info.sizes.map((s) => (
          <button key={s} role="radio" aria-checked={s === size} className={s === size ? 'is-on' : ''} onClick={() => setSize(s)}>
            <SizeMap size={s} rows={rowsFor(type, s)} />
            <span>
              <strong>{SIZE_NAMES[s]}</strong>
              <span className="muted">
                {SIZE_SHARE[s]} · {rowsFor(type, s) === 1 ? 'short' : 'tall'}
              </span>
            </span>
          </button>
        ))}
      </div>

      <div className="preview-stage">
        <Preview key={size} type={type} size={size} ctx={ctx} gridWidth={gridWidth} box={{ w: 760, h: 300 }} />
      </div>

      <footer className="picker-foot">
        <span className="muted small">You can change the size later in Customize.</span>
        <button className="button button-primary" onClick={() => onAdd(size)}>
          <Icon name="plus" size={14} /> Add {SIZE_NAMES[size].toLowerCase()} widget
        </button>
      </footer>
    </>
  );
}

/** Add a widget: pick one from a gallery of live previews, then pick its size. */
export function WidgetPicker({
  layout,
  ctx,
  onAdd,
  onClose,
}: {
  layout: PlacedWidget[];
  ctx: WidgetContext;
  onAdd: (type: WidgetType, size: WidgetSize) => void;
  onClose: () => void;
}) {
  const [closing, close] = useAnimatedClose(onClose);
  const choices = availableWidgets(layout);
  const [chosen, setChosen] = useState<WidgetType | null>(null);
  // Previews are drawn at the page's real widget sizes.
  const [gridWidth] = useState(() => document.querySelector('.widgets')?.clientWidth || 1160);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (chosen) setChosen(null);
      else close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chosen, close]);

  return (
    <div className={`overlay ${closing ? 'is-closing' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="settings picker" role="dialog" aria-label="Add a widget">
        {/* Slides between the gallery and the size chooser. */}
        <div className={`picker-view ${chosen ? 'is-sizes' : 'is-gallery'}`} key={chosen ?? 'gallery'}>
          {chosen ? (
            <SizeChooser
              type={chosen}
              ctx={ctx}
              gridWidth={gridWidth}
              onBack={() => setChosen(null)}
              onAdd={(size) => {
                onAdd(chosen, size);
                setChosen(null);
              }}
            />
          ) : (
            <>
              <header className="card-header">
                <h2>Add a widget</h2>
                <button className="button" onClick={close}>
                  Done
                </button>
              </header>
              {choices.length === 0 ? (
                <p className="muted">Every widget is already on your page.</p>
              ) : (
                <ul className="gallery">
                  {choices.map((type, n) => (
                    <li key={type} style={{ ['--n' as string]: n } as CSSProperties}>
                      <button className="gallery-item" onClick={() => setChosen(type)}>
                        <span className="gallery-shot">
                          <Preview type={type} size={WIDGETS[type].defaultSize} ctx={ctx} gridWidth={gridWidth} box={{ w: 216, h: 104 }} />
                        </span>
                        <strong>{WIDGETS[type].title}</strong>
                        <span className="muted small">{WIDGETS[type].sizes.map((s) => s.toUpperCase()).join(' · ')}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
