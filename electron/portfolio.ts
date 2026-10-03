import { HttpError, fetchJson } from './http';
import { JsonFile } from './smart/store';
import {
  MAX_HOLDINGS,
  cleanSymbol,
  emptyPortfolio,
  feedSymbol,
  normalizePortfolio,
  parseChart,
  type Portfolio,
  type PortfolioData,
  type Quote,
} from '../src/shared/portfolio';

/** Prices are reused for a minute, so many widgets on screen ask the feed only once. */
const FRESH_MS = 60_000;

/** One ticker's price and today's line, from Yahoo Finance's free chart feed (no account or key). */
async function fetchQuote(symbol: string): Promise<Quote | null> {
  const path = `/v8/finance/chart/${encodeURIComponent(feedSymbol(symbol))}?range=1d&interval=5m`;
  let lastError: unknown;
  // Two copies of the same feed; when one is busy the other usually isn't.
  for (const host of ['query1', 'query2']) {
    try {
      return parseChart(await fetchJson<unknown>(`https://${host}.finance.yahoo.com${path}`, {}, 15_000), symbol);
    } catch (err) {
      // The feed answers 404 for tickers it doesn't know.
      if (err instanceof HttpError && err.status === 404) return null;
      lastError = err;
    }
  }
  if (lastError instanceof HttpError && lastError.status === 429) throw new Error('The free price service is busy. Prices will update in a minute.');
  throw lastError;
}

/** The stocks and crypto you typed in, saved in the app data folder, plus their live prices. */
export class PortfolioStore {
  private readonly file: JsonFile<unknown>;
  private quotes: Record<string, Quote> = {};
  private fetchedAt = 0;
  private error: string | undefined;

  constructor(filePath: string) {
    this.file = new JsonFile<unknown>(filePath, emptyPortfolio);
  }

  private saved(): Portfolio {
    return normalizePortfolio(this.file.read());
  }

  private save(next: Portfolio): Portfolio {
    const clean = normalizePortfolio(next);
    this.file.write(clean);
    return clean;
  }

  async data(force = false): Promise<PortfolioData> {
    const portfolio = this.saved();
    const missing = portfolio.holdings.some((h) => !this.quotes[h.symbol]);
    if (force || missing || Date.now() - this.fetchedAt > FRESH_MS) {
      const results = await Promise.allSettled(portfolio.holdings.map((h) => fetchQuote(h.symbol)));
      const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value) this.quotes[portfolio.holdings[i].symbol] = r.value;
      });
      this.error = failed.length ? (failed[0].reason instanceof Error ? failed[0].reason.message : String(failed[0].reason)) : undefined;
      this.fetchedAt = Date.now();
    }
    const quotes = Object.fromEntries(portfolio.holdings.filter((h) => this.quotes[h.symbol]).map((h) => [h.symbol, this.quotes[h.symbol]]));
    return { ...portfolio, quotes, fetchedAt: new Date(this.fetchedAt || Date.now()).toISOString(), ...(this.error && { error: this.error }) };
  }

  /** Adds a ticker (or changes how many you own, if it's already there) after checking it has a price. */
  async add(symbolText: string, shares: number): Promise<PortfolioData> {
    const symbol = cleanSymbol(String(symbolText ?? ''));
    if (!symbol) throw new Error('Type a ticker, like AAPL or BTC.');
    if (!Number.isFinite(shares) || shares <= 0) throw new Error('Type how many shares you own, like 3 or 0.5.');
    const portfolio = this.saved();
    const existing = portfolio.holdings.find((h) => h.symbol === symbol);
    if (!existing && portfolio.holdings.length >= MAX_HOLDINGS) throw new Error(`You can track up to ${MAX_HOLDINGS}.`);
    const quote = await fetchQuote(symbol);
    if (!quote) throw new Error(`Couldn't find a price for ${symbol}. Check the ticker.`);
    this.quotes[symbol] = quote;
    const holdings = existing
      ? portfolio.holdings.map((h) => (h.symbol === symbol ? { ...h, shares } : h))
      : [...portfolio.holdings, { id: `${symbol}-${Date.now().toString(36)}`, symbol, shares }];
    this.save({ ...portfolio, holdings });
    return this.data();
  }

  /** Saves edits from the editor: changed share counts and removed rows. */
  async setHoldings(list: unknown): Promise<PortfolioData> {
    const portfolio = this.saved();
    this.save({ ...portfolio, holdings: normalizePortfolio({ holdings: list }).holdings });
    return this.data();
  }

  async setHidden(hidden: boolean): Promise<PortfolioData> {
    this.save({ ...this.saved(), hidden: Boolean(hidden) });
    return this.data();
  }
}
