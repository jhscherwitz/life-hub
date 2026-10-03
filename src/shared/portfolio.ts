// Portfolio: the stocks and crypto you own, typed in once, valued with free
// live prices. Nothing here touches a brokerage account.

export interface Holding {
  id: string;
  /** What you typed, like "AAPL" or "BTC". */
  symbol: string;
  shares: number;
}

export interface Portfolio {
  holdings: Holding[];
  /** Show dots instead of dollar amounts, for when someone's looking at your screen. */
  hidden: boolean;
}

export interface Quote {
  symbol: string;
  name: string;
  price: number;
  /** Last close before today, so "today" means since then. */
  previousClose: number;
  /** Today's prices, oldest first, with their times in ms. */
  points: { at: number; price: number }[];
  /** The market is open right now (crypto is always open). */
  open: boolean;
}

export interface PortfolioData extends Portfolio {
  /** Keyed by holding symbol. Missing when the price couldn't be loaded. */
  quotes: Record<string, Quote>;
  fetchedAt: string;
  error?: string;
}

export const MAX_HOLDINGS = 20;

export function emptyPortfolio(): Portfolio {
  return { holdings: [], hidden: false };
}

// Robinhood users often type just "BTC"; the free price feed calls it "BTC-USD".
const CRYPTO = new Set([
  'BTC',
  'ETH',
  'SOL',
  'DOGE',
  'ADA',
  'XRP',
  'LTC',
  'SHIB',
  'AVAX',
  'DOT',
  'LINK',
  'BCH',
  'ETC',
  'XLM',
  'UNI',
  'AAVE',
  'PEPE',
  'COMP',
  'XTZ',
]);

/** "aapl " → "AAPL", "$tsla" → "TSLA", "brk.b" → "BRK.B". Empty when it can't be a ticker. */
export function cleanSymbol(text: string): string {
  const s = text.trim().replace(/^\$/, '').toUpperCase();
  return /^[A-Z0-9][A-Z0-9.\-^=]{0,14}$/.test(s) ? s : '';
}

/** The symbol the price feed knows: crypto gets "-USD", class shares use "-" ("BRK.B" → "BRK-B"). */
export function feedSymbol(symbol: string): string {
  if (CRYPTO.has(symbol)) return `${symbol}-USD`;
  return symbol.replace(/\./g, '-');
}

export function isCrypto(symbol: string): boolean {
  return CRYPTO.has(symbol) || symbol.endsWith('-USD');
}

/** Cleans saved holdings: real tickers, positive share counts, no repeats. */
export function normalizePortfolio(value: unknown): Portfolio {
  const v = (value ?? {}) as Partial<Portfolio>;
  const holdings: Holding[] = [];
  for (const item of Array.isArray(v.holdings) ? v.holdings : []) {
    const h = item as Partial<Holding> | null;
    if (!h || typeof h.id !== 'string' || typeof h.symbol !== 'string' || typeof h.shares !== 'number') continue;
    const symbol = cleanSymbol(h.symbol);
    if (!symbol || !Number.isFinite(h.shares) || h.shares <= 0 || holdings.some((o) => o.symbol === symbol)) continue;
    holdings.push({ id: h.id.slice(0, 64), symbol, shares: Math.round(h.shares * 1e8) / 1e8 });
  }
  return { holdings: holdings.slice(0, MAX_HOLDINGS), hidden: v.hidden === true };
}

interface ChartJson {
  chart?: {
    result?: {
      meta?: {
        symbol?: string;
        longName?: string;
        shortName?: string;
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        previousClose?: number;
        regularMarketTime?: number;
        currentTradingPeriod?: { regular?: { start?: number; end?: number } };
      };
      timestamp?: number[];
      indicators?: { quote?: { close?: (number | null)[] }[] };
    }[];
    error?: { description?: string } | null;
  };
}

/** Reads one answer from the free chart feed. Null when it has no price for that ticker. */
export function parseChart(json: unknown, symbol: string, now = Date.now()): Quote | null {
  const result = (json as ChartJson)?.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta || typeof meta.regularMarketPrice !== 'number') return null;
  const times = result.timestamp ?? [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const points: Quote['points'] = [];
  times.forEach((t, i) => {
    const price = closes[i];
    if (typeof price === 'number' && Number.isFinite(price)) points.push({ at: t * 1000, price });
  });
  const regular = meta.currentTradingPeriod?.regular;
  const open = isCrypto(symbol) || (regular?.start !== undefined && regular.end !== undefined && now >= regular.start * 1000 && now < regular.end * 1000);
  const name = (meta.shortName || meta.longName || symbol).replace(/\s+USD$/, '');
  return {
    symbol,
    name,
    price: meta.regularMarketPrice,
    previousClose: meta.chartPreviousClose ?? meta.previousClose ?? points[0]?.price ?? meta.regularMarketPrice,
    points,
    open,
  };
}

export interface HoldingView extends Holding {
  quote?: Quote;
  value: number;
  /** Dollars up or down today. */
  change: number;
  /** Percent up or down today. */
  changePct: number;
}

export interface PortfolioView {
  total: number;
  change: number;
  changePct: number;
  rows: HoldingView[];
  /** Total value across the day, for the little chart. */
  line: number[];
  /** The holding that moved the most today (by percent). */
  mover?: HoldingView;
  open: boolean;
  /** Some prices didn't load. */
  missing: number;
}

const pct = (change: number, base: number) => (base ? (change / base) * 100 : 0);

/** Adds it all up. Holdings without a price count as zero and are reported as missing. */
export function portfolioView(holdings: Holding[], quotes: Record<string, Quote>, buckets = 48): PortfolioView {
  const rows: HoldingView[] = holdings.map((h) => {
    const quote = quotes[h.symbol];
    if (!quote) return { ...h, value: 0, change: 0, changePct: 0 };
    const value = quote.price * h.shares;
    const change = (quote.price - quote.previousClose) * h.shares;
    return { ...h, quote, value, change, changePct: pct(quote.price - quote.previousClose, quote.previousClose) };
  });
  const priced = rows.filter((r) => r.quote);
  const total = priced.reduce((s, r) => s + r.value, 0);
  const change = priced.reduce((s, r) => s + r.change, 0);

  // The day's line: sample every holding at the same moments, using each one's last price at or before then.
  const all = priced.flatMap((r) => r.quote!.points.map((p) => p.at));
  const line: number[] = [];
  if (all.length) {
    const start = Math.min(...all);
    const end = Math.max(...all);
    const steps = end > start ? buckets : 1;
    for (let i = 0; i < steps; i++) {
      const at = steps === 1 ? end : start + ((end - start) * i) / (steps - 1);
      let sum = 0;
      for (const r of priced) {
        const q = r.quote!;
        let price = q.previousClose;
        for (const p of q.points) {
          if (p.at > at) break;
          price = p.price;
        }
        sum += price * r.shares;
      }
      line.push(sum);
    }
    line.push(total);
  }

  const mover = [...priced].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))[0];
  return {
    total,
    change,
    changePct: pct(change, total - change),
    rows: rows.sort((a, b) => b.value - a.value),
    line,
    mover,
    open: priced.some((r) => r.quote!.open),
    missing: rows.length - priced.length,
  };
}

/** "$1,234.56". When `short`, fits a tiny tile: "$812.40", "$4,966", "$123.5K", "$1.2M". */
export function money(n: number, short = false): string {
  if (short && Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (short && Math.abs(n) >= 1e5) return `$${(n / 1e3).toFixed(1)}K`;
  if (short && Math.abs(n) >= 1e3) return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: Math.abs(n) < 1 && n !== 0 ? 4 : 2 });
}

/** "+$12.34", "−$5.00". */
export function signedMoney(n: number): string {
  return `${n >= 0 ? '+' : '−'}${money(Math.abs(n))}`;
}

/** "+1.23%", "−0.40%". */
export function signedPct(n: number): string {
  return `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}%`;
}

/** "3", "0.5", "0.00012345". */
export function sharesText(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 8 });
}
