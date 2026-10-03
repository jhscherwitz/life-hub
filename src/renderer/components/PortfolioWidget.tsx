import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  MAX_HOLDINGS,
  money,
  portfolioView,
  sharesText,
  signedMoney,
  signedPct,
  type Holding,
  type PortfolioData,
  type PortfolioView,
} from '../../shared/portfolio';
import { errorText } from '../hooks';
import { Card } from './Card';
import { Icon } from './Icon';
import { Tile, type TileContext } from './tiles';

/** Your holdings and their prices. Life Hub reuses prices for a minute, so this is cheap to ask for. */
export function usePortfolio() {
  const supported = typeof window.hub.getPortfolio === 'function';
  const [data, setData] = useState<PortfolioData | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!supported) return;
    let alive = true;
    const load = () =>
      window.hub.getPortfolio().then(
        (d) => alive && setData(d),
        (err) => alive && setError(errorText(err)),
      );
    void load();
    const timer = setInterval(load, 2 * 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [supported]);
  const run = async (job: Promise<PortfolioData>) => {
    const next = await job;
    setData(next);
    setError('');
    return next;
  };
  return {
    supported,
    data,
    error: error || data?.error || '',
    add: (symbol: string, shares: number) => run(window.hub.addHolding(symbol, shares)),
    setHoldings: (list: Holding[]) => run(window.hub.setHoldings(list)),
    setHidden: (hidden: boolean) => run(window.hub.hidePortfolio(hidden)),
  };
}

const HIDDEN = '••••';

function tone(n: number): string {
  return n > 0 ? 'is-up' : n < 0 ? 'is-down' : '';
}

/** The day's value as a line, filled underneath, green when up and red when down. */
function Spark({ line, up, height = 40 }: { line: number[]; up: boolean; height?: number }) {
  const id = useId();
  if (line.length < 2) return <div className="pf-spark is-empty" style={{ height }} />;
  const min = Math.min(...line);
  const max = Math.max(...line);
  const span = max - min || 1;
  const w = 100;
  const pts = line.map((v, i) => [(i / (line.length - 1)) * w, height - 3 - ((v - min) / span) * (height - 6)]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
  const color = up ? 'var(--green)' : 'var(--danger)';
  return (
    <svg className="pf-spark" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ height }} aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.32" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L${w} ${height} L0 ${height} Z`} fill={`url(#${id})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

function HoldingsEditor({
  data,
  onAdd,
  onSave,
  onClose,
}: {
  data: PortfolioData | null;
  onAdd: (symbol: string, shares: number) => Promise<unknown>;
  onSave: (list: Holding[]) => Promise<unknown>;
  onClose: () => void;
}) {
  const [symbol, setSymbol] = useState('');
  const [shares, setShares] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [edits, setEdits] = useState<Record<string, string>>({});
  const holdings = data?.holdings ?? [];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const add = async () => {
    const n = Number(shares.replace(/,/g, ''));
    setBusy(true);
    setError('');
    try {
      await onAdd(symbol, n);
      setSymbol('');
      setShares('');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const saveShares = (h: Holding) => {
    const text = edits[h.id];
    if (text === undefined) return;
    const n = Number(text.replace(/,/g, ''));
    if (!Number.isFinite(n) || n <= 0) return setEdits({ ...edits, [h.id]: sharesText(h.shares) });
    void onSave(holdings.map((x) => (x.id === h.id ? { ...x, shares: n } : x)));
  };

  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="settings countdown-editor pf-editor" role="dialog" aria-label="Portfolio">
        <header className="card-header">
          <h2>Portfolio</h2>
          <button className="button" onClick={onClose}>
            Done
          </button>
        </header>
        <p className="muted small">
          Type in what you own, like in Robinhood. Life Hub only looks up prices. It never signs in to any account. Crypto works too: type BTC, ETH or DOGE.
        </p>
        <ul className="countdown-rows pf-rows">
          {holdings.map((h) => {
            const q = data?.quotes[h.symbol];
            return (
              <li key={h.id}>
                <span className="pf-row-name">
                  <strong>{h.symbol}</strong>
                  <span className="muted small tile-clip">{q ? `${q.name} · ${money(q.price)}` : 'No price yet'}</span>
                </span>
                <input
                  className="pf-shares"
                  inputMode="decimal"
                  value={edits[h.id] ?? sharesText(h.shares)}
                  onChange={(e) => setEdits({ ...edits, [h.id]: e.target.value })}
                  onBlur={() => saveShares(h)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  aria-label={`Shares of ${h.symbol}`}
                />
                <button
                  className="task-remove"
                  onClick={() => void onSave(holdings.filter((x) => x.id !== h.id))}
                  aria-label={`Remove ${h.symbol}`}
                  title="Remove"
                >
                  <Icon name="x" size={14} />
                </button>
              </li>
            );
          })}
        </ul>
        {holdings.length < MAX_HOLDINGS && (
          <form
            className="countdown-add pf-add"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="Ticker (AAPL, VOO, BTC…)" aria-label="Ticker" autoFocus />
            <input
              className="pf-shares"
              inputMode="decimal"
              value={shares}
              onChange={(e) => setShares(e.target.value)}
              placeholder="Shares"
              aria-label="Shares"
            />
            <button className="button button-primary" disabled={busy || !symbol.trim() || !shares.trim()}>
              {busy ? 'Checking…' : 'Add'}
            </button>
          </form>
        )}
        {error && <p className="settings-error small">{error}</p>}
        <p className="muted small pf-source">Free prices from Yahoo Finance. Stocks can be up to 15 minutes behind.</p>
      </div>
    </div>,
    document.body,
  );
}

function Header({ view, hidden, showChange = true }: { view: PortfolioView; hidden: boolean; showChange?: boolean }) {
  return (
    <div className="pf-head">
      <span className="pf-total">{hidden ? HIDDEN : money(view.total)}</span>
      {showChange && (
        <span className={`pf-change ${tone(view.change)}`}>
          {hidden ? '' : `${signedMoney(view.change)} `}
          <b>{signedPct(view.changePct)}</b> <span className="muted">today</span>
        </span>
      )}
    </div>
  );
}

/** What your stocks and crypto are worth right now, and how they did today. */
export function PortfolioWidget({ size }: TileContext) {
  const { supported, data, error, add, setHoldings, setHidden } = usePortfolio();
  const [editing, setEditing] = useState(false);
  if (!supported) {
    return (
      <Card title="Portfolio">
        <p className="muted">Restart Life Hub to use this widget.</p>
      </Card>
    );
  }
  const editor = editing && <HoldingsEditor data={data} onAdd={add} onSave={setHoldings} onClose={() => setEditing(false)} />;
  const holdings = data?.holdings ?? [];
  const view = portfolioView(holdings, data?.quotes ?? {});
  const hidden = data?.hidden ?? false;
  const empty = data !== null && holdings.length === 0;

  if (size === 'xs') {
    return (
      <>
        <Tile
          label="Portfolio"
          className={`tile-portfolio ${tone(view.change)}`}
          onClick={() => setEditing(true)}
          title={empty ? 'Add what you own' : `${money(view.total)} · ${signedPct(view.changePct)} today`}
        >
          {empty ? (
            <>
              <Icon name="trend" size={24} />
              <span className="tile-foot">Add stocks</span>
            </>
          ) : (
            <>
              <span className="tile-big tile-big-sm">{hidden ? HIDDEN : data ? money(view.total, true) : '…'}</span>
              <span className={`pf-change ${tone(view.change)}`}>
                <b>{data ? signedPct(view.changePct) : ''}</b>
              </span>
              <Spark line={view.line} up={view.change >= 0} height={26} />
            </>
          )}
        </Tile>
        {editor}
      </>
    );
  }

  const actions = (
    <span className="pf-actions">
      {!empty && (
        <button
          className="pf-eye"
          onClick={() => void setHidden(!hidden)}
          title={hidden ? 'Show amounts' : 'Hide amounts'}
          aria-label={hidden ? 'Show amounts' : 'Hide amounts'}
        >
          <Icon name={hidden ? 'eye-off' : 'eye'} size={14} />
        </button>
      )}
      <button className="link-button" onClick={() => setEditing(true)}>
        {empty ? 'Add' : 'Edit'}
      </button>
    </span>
  );
  const shown = view.rows.slice(0, size === 's' ? 2 : 3);

  return (
    <>
      <Card title="Portfolio" meta={data && !empty ? (view.open ? 'live' : 'closed') : undefined} action={actions} className={`pf-card pf-${size}`}>
        {!data ? (
          <p className="muted small">{error || 'Loading prices…'}</p>
        ) : empty ? (
          <div className="pf-empty">
            <Icon name="trend" size={26} />
            <p className="muted small">Type in the stocks and crypto you own and see what they're worth, live.</p>
            <button className="button" onClick={() => setEditing(true)}>
              Add what you own
            </button>
          </div>
        ) : (
          <>
            <Header view={view} hidden={hidden} />
            <Spark line={view.line} up={view.change >= 0} height={size === 's' ? 34 : 44} />
            <ul className="pf-list">
              {shown.map((r) => (
                <li key={r.id}>
                  <span className="pf-sym">
                    <strong>{r.symbol}</strong>
                    {size !== 's' && (
                      <span className="muted small tile-clip">
                        {hidden ? `${sharesText(r.shares)} shares` : `${sharesText(r.shares)} × ${r.quote ? money(r.quote.price) : '—'}`}
                      </span>
                    )}
                  </span>
                  {size !== 's' && <span className="pf-value">{hidden ? HIDDEN : r.quote ? money(r.value) : '—'}</span>}
                  <span className={`pf-pill ${tone(r.changePct)}`}>{r.quote ? signedPct(r.changePct) : '—'}</span>
                </li>
              ))}
            </ul>
            {view.rows.length > shown.length && (
              <button className="card-foot link-button pf-more" onClick={() => setEditing(true)}>
                +{view.rows.length - shown.length} more
              </button>
            )}
            {error && <p className="settings-error small">{error}</p>}
          </>
        )}
      </Card>
      {editor}
    </>
  );
}
