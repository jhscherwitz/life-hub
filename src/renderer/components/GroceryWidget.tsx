import { useEffect, useRef, useState } from 'react';
import { groceryAisles, newGrocery, type Aisle, type Extras, type GroceryItem } from '../../shared/extras';
import { errorText } from '../hooks';
import { Card } from './Card';
import { Icon } from './Icon';
import { Tile, type TileContext } from './tiles';

/** A colour for each store section, so the list scans at a glance. */
const AISLE_TONE: Record<Aisle, string> = {
  Produce: '#5fd068',
  Bakery: '#e8b46a',
  'Dairy & eggs': '#8fc8ff',
  'Meat & fish': '#ff8a8a',
  Pantry: '#d9a46c',
  Frozen: '#7fe3f0',
  Snacks: '#ffb547',
  Drinks: '#b49cff',
  Household: '#a7b0c8',
  Other: '#8d91ad',
};

/** The list, loaded once and again whenever the AI adds to it. */
function useGroceries() {
  const supported = typeof window.hub.setGroceries === 'function';
  const [items, setItems] = useState<GroceryItem[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!supported) return;
    let alive = true;
    const load = () => window.hub.getExtras().then((e) => alive && setItems(e.groceries ?? []), (err) => alive && setError(errorText(err)));
    void load();
    const stop = window.hub.onExtras?.(() => void load());
    return () => {
      alive = false;
      stop?.();
    };
  }, [supported]);
  const save = (next: GroceryItem[]) => {
    setItems(next);
    window.hub.setGroceries(next).then(
      (e: Extras) => setItems(e.groceries),
      (err) => setError(errorText(err)),
    );
  };
  return { supported, items: items ?? [], loaded: items !== null, error, save };
}

export function GroceryWidget({ size }: TileContext) {
  const { supported, items, loaded, error, save } = useGroceries();
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  if (!supported) {
    return (
      <Card title="Grocery list">
        <p className="muted">Restart Life Hub to use this widget.</p>
      </Card>
    );
  }
  const left = items.filter((i) => !i.done).length;
  const done = items.length - left;

  if (size === 'xs') {
    return (
      <Tile label="Groceries" className="tile-groceries" title={left ? items.filter((i) => !i.done).map((i) => i.name).join(', ') : 'Nothing to buy'}>
        <span className="grocery-tile-icon">
          <Icon name="cart" size={18} />
        </span>
        <span className="tile-big">{left}</span>
        <span className="tile-foot">{left === 1 ? 'thing to buy' : 'things to buy'}</span>
      </Tile>
    );
  }

  const add = () => {
    const parts = text
      .split(/,|\band\b/i)
      .map((t) => t.trim())
      .filter(Boolean);
    const added = parts.map((p) => newGrocery(p, crypto.randomUUID())).filter((g): g is GroceryItem => !!g);
    if (added.length) save([...items, ...added]);
    setText('');
    input.current?.focus();
  };
  const toggle = (id: string) => save(items.map((i) => (i.id === id ? { ...i, done: !i.done } : i)));
  const remove = (id: string) => save(items.filter((i) => i.id !== id));

  return (
    <Card
      title="Grocery list"
      className="grocery-card"
      meta={items.length ? `${left} left` : undefined}
      action={
        done > 0 ? (
          <button className="link-button" onClick={() => save(items.filter((i) => !i.done))} title="Take ticked-off items off the list">
            Clear {done} done
          </button>
        ) : undefined
      }
    >
      {items.length > 0 && (
        <div className="grocery-progress" aria-hidden="true">
          <span style={{ width: `${(done / items.length) * 100}%` }} />
        </div>
      )}
      <form
        className="grocery-add"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Icon name="plus" size={14} />
        <input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder="Add milk, 2 avocados…" aria-label="Add to grocery list" maxLength={200} />
      </form>
      {loaded && items.length === 0 ? (
        <div className="grocery-empty">
          <Icon name="cart" size={22} />
          <span>Your list is empty.</span>
          <span className="muted small">Add things above, or tell the AI “add eggs and bread to my grocery list”.</span>
        </div>
      ) : (
        <div className="grocery-aisles">
          {groceryAisles(items).map(({ aisle, items: list }) => (
            <section key={aisle} className="grocery-aisle" style={{ ['--aisle' as string]: AISLE_TONE[aisle] }}>
              <h3>
                <span className="grocery-dot" />
                {aisle}
              </h3>
              <ul>
                {list.map((i) => (
                  <li key={i.id} className={i.done ? 'is-done' : ''}>
                    <button className="grocery-check" onClick={() => toggle(i.id)} aria-label={i.done ? `Untick ${i.name}` : `Tick off ${i.name}`} aria-pressed={i.done}>
                      {i.done && <Icon name="check" size={11} />}
                    </button>
                    <span className="grocery-name" onClick={() => toggle(i.id)}>
                      {i.name}
                    </span>
                    {i.qty && <span className="grocery-qty">{i.qty}</span>}
                    <button className="grocery-remove" onClick={() => remove(i.id)} aria-label={`Remove ${i.name}`} title="Remove">
                      <Icon name="x" size={11} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      {error && <p className="settings-error">{error}</p>}
    </Card>
  );
}
