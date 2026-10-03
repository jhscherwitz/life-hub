import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PortfolioStore } from '../electron/portfolio';
import { cleanSymbol, feedSymbol, money, normalizePortfolio, parseChart, portfolioView, signedMoney, signedPct, type Quote } from '../src/shared/portfolio';

const OPEN = 1_790_947_800; // 9:30 AM New York, in seconds
const CLOSE = OPEN + 6.5 * 3600;

function chart(symbol: string, prev: number, closes: (number | null)[], price = closes[closes.length - 1] ?? prev) {
  return {
    chart: {
      result: [
        {
          meta: {
            symbol,
            shortName: `${symbol} Inc.`,
            regularMarketPrice: price,
            chartPreviousClose: prev,
            currentTradingPeriod: { regular: { start: OPEN, end: CLOSE } },
          },
          timestamp: closes.map((_, i) => OPEN + i * 300),
          indicators: { quote: [{ close: closes }] },
        },
      ],
      error: null,
    },
  };
}

function quote(symbol: string, prev: number, prices: number[], start = OPEN * 1000): Quote {
  return {
    symbol,
    name: symbol,
    price: prices[prices.length - 1],
    previousClose: prev,
    points: prices.map((price, i) => ({ at: start + i * 300_000, price })),
    open: true,
  };
}

describe('tickers', () => {
  it('cleans what people type', () => {
    expect(cleanSymbol(' aapl ')).toBe('AAPL');
    expect(cleanSymbol('$tsla')).toBe('TSLA');
    expect(cleanSymbol('brk.b')).toBe('BRK.B');
    expect(cleanSymbol('apple inc')).toBe('');
    expect(cleanSymbol('')).toBe('');
  });

  it('names crypto and class shares the way the price feed does', () => {
    expect(feedSymbol('BTC')).toBe('BTC-USD');
    expect(feedSymbol('DOGE')).toBe('DOGE-USD');
    expect(feedSymbol('BRK.B')).toBe('BRK-B');
    expect(feedSymbol('AAPL')).toBe('AAPL');
  });
});

describe('normalizePortfolio', () => {
  it('keeps real holdings and drops junk and repeats', () => {
    const p = normalizePortfolio({
      holdings: [
        { id: 'a', symbol: 'aapl', shares: 3 },
        { id: 'b', symbol: 'AAPL', shares: 1 },
        { id: 'c', symbol: 'VOO', shares: 0 },
        { id: 'd', symbol: 'not a ticker', shares: 2 },
        { id: 'e', symbol: 'BTC', shares: 0.0012345 },
        null,
      ],
      hidden: true,
    });
    expect(p.holdings.map((h) => [h.symbol, h.shares])).toEqual([
      ['AAPL', 3],
      ['BTC', 0.0012345],
    ]);
    expect(p.hidden).toBe(true);
    expect(normalizePortfolio(null)).toEqual({ holdings: [], hidden: false });
  });
});

describe('parseChart', () => {
  it('reads the price, the last close and the day', () => {
    const q = parseChart(chart('AAPL', 100, [101, null, 103]), 'AAPL', (OPEN + 3600) * 1000)!;
    expect(q.price).toBe(103);
    expect(q.previousClose).toBe(100);
    expect(q.points.map((p) => p.price)).toEqual([101, 103]);
    expect(q.name).toBe('AAPL Inc.');
    expect(q.open).toBe(true);
  });

  it('knows when the market is closed, but crypto never closes', () => {
    expect(parseChart(chart('AAPL', 100, [101]), 'AAPL', (CLOSE + 60) * 1000)!.open).toBe(false);
    expect(parseChart(chart('BTC-USD', 100, [101]), 'BTC', (CLOSE + 60) * 1000)!.open).toBe(true);
  });

  it('returns null when there is no price', () => {
    expect(parseChart({ chart: { result: null, error: { description: 'No data found' } } }, 'NOPE')).toBeNull();
    expect(parseChart('nonsense', 'NOPE')).toBeNull();
  });
});

describe('portfolioView', () => {
  const holdings = [
    { id: '1', symbol: 'AAPL', shares: 2 },
    { id: '2', symbol: 'VOO', shares: 1 },
    { id: '3', symbol: 'GONE', shares: 5 },
  ];
  const quotes = { AAPL: quote('AAPL', 100, [100, 105, 110]), VOO: quote('VOO', 500, [500, 495, 490]) };

  it('adds up the value and today’s change', () => {
    const v = portfolioView(holdings, quotes, 3);
    expect(v.total).toBe(2 * 110 + 490);
    expect(v.change).toBe(2 * 10 - 10);
    expect(v.changePct).toBeCloseTo((10 / 700) * 100);
    expect(v.missing).toBe(1);
    expect(v.rows.map((r) => r.symbol)).toEqual(['VOO', 'AAPL', 'GONE']);
  });

  it('picks the biggest mover by percent', () => {
    expect(portfolioView(holdings, quotes).mover?.symbol).toBe('AAPL');
  });

  it('draws the day as one line, ending at the total', () => {
    const v = portfolioView(holdings, quotes, 3);
    expect(v.line[0]).toBe(2 * 100 + 500);
    expect(v.line[v.line.length - 1]).toBe(v.total);
  });

  it('is empty with nothing priced', () => {
    const v = portfolioView([], {});
    expect(v.total).toBe(0);
    expect(v.line).toEqual([]);
    expect(v.mover).toBeUndefined();
  });
});

describe('money', () => {
  it('formats amounts and moves', () => {
    expect(money(1234.5)).toBe('$1,234.50');
    expect(money(4966.14, true)).toBe('$4,966');
    expect(money(123_456, true)).toBe('$123.5K');
    expect(money(2_500_000, true)).toBe('$2.5M');
    expect(signedMoney(-5)).toBe('−$5.00');
    expect(signedPct(1.234)).toBe('+1.23%');
    expect(signedPct(-0.4)).toBe('−0.40%');
  });
});

describe('PortfolioStore', () => {
  let dir: string;
  afterEach(() => {
    vi.unstubAllGlobals();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  function stubFeed(handler: (url: string) => Response) {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        return handler(url);
      }),
    );
    return calls;
  }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  it('checks a ticker has a price before adding it, and saves it', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-'));
    const calls = stubFeed((url) => (url.includes('BTC-USD') ? json(chart('BTC-USD', 60000, [61000])) : json({ chart: { result: null } }, 404)));
    const store = new PortfolioStore(path.join(dir, 'portfolio.json'));
    const data = await store.add('btc', 0.01);
    expect(data.holdings.map((h) => h.symbol)).toEqual(['BTC']);
    expect(data.quotes.BTC.price).toBe(61000);
    expect(calls[0]).toContain('/v8/finance/chart/BTC-USD');
    await expect(store.add('zzzz', 1)).rejects.toThrow("Couldn't find a price for ZZZZ");
    await expect(store.add('AAPL', 0)).rejects.toThrow('how many shares');
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'portfolio.json'), 'utf8')).holdings).toHaveLength(1);
  });

  it('tries the second copy of the feed when the first is busy', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-'));
    stubFeed((url) => (url.startsWith('https://query1.') ? json('busy', 429) : json(chart('AAPL', 100, [102]))));
    const store = new PortfolioStore(path.join(dir, 'portfolio.json'));
    const data = await store.add('AAPL', 2);
    expect(data.quotes.AAPL.price).toBe(102);
  });

  it('says so in plain words when the feed is busy everywhere', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-'));
    fs.writeFileSync(path.join(dir, 'portfolio.json'), JSON.stringify({ holdings: [{ id: 'a', symbol: 'AAPL', shares: 1 }] }));
    stubFeed(() => json('busy', 429));
    const data = await new PortfolioStore(path.join(dir, 'portfolio.json')).data();
    expect(data.error).toContain('busy');
    expect(data.holdings).toHaveLength(1);
  });
});
