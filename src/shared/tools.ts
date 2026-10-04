// Things the AI in Chat can look up before it answers: the web, a web page,
// stock prices over time, and the person's own email and calendar. The AI
// asks for a tool, Life Hub runs it and hands back what it found, and the AI
// answers with that (see electron/smart/tools.ts). It can also use Life Hub's
// browser: read the page you're on, open sites, click, type and scroll.

export const TOOL_NAMES = [
  'web_search',
  'read_page',
  'stock_history',
  'portfolio_history',
  'search_email',
  'read_email',
  'search_calendar',
  'browser_read',
  'browser_open',
  'browser_click',
  'browser_type',
  'browser_scroll',
  'browser_back',
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const STOCK_RANGES = ['5d', '1mo', '3mo', '6mo', 'ytd', '1y', '2y', '5y', 'max'] as const;
export type StockRange = (typeof STOCK_RANGES)[number];

/** One tool as the AI asks for it. */
export interface ToolCall {
  name: ToolName;
  /** web_search, search_email, search_calendar: what to look for. */
  query?: string;
  /** read_page: the address. */
  url?: string;
  /** stock_history: tickers. */
  symbols?: string[];
  /** stock_history, portfolio_history: how far back. */
  range?: StockRange;
  /** read_email: the email's id. browser_click, browser_type: the number of the thing on the page. */
  id?: string;
  /** browser_type: what to type (or the option to pick in a dropdown). */
  text?: string;
  /** browser_type: press Enter after typing. */
  submit?: boolean;
  /** browser_open: in a new tab. */
  new_tab?: boolean;
  /** browser_scroll. */
  direction?: 'up' | 'down' | 'top' | 'bottom';
}

export interface Source {
  title: string;
  url: string;
}

/** What the AI looked up, shown above its reply ("Searched the web"). */
export interface ToolStep {
  name: ToolName;
  /** "Searched the web", "Checked stock prices"… */
  label: string;
  /** The search words, the page, the tickers. */
  detail: string;
  ok: boolean;
  sources?: Source[];
}

/** At most this many tools per round, so one answer can't run away. */
const MAX_CALLS = 4;

/** Keeps only well-formed tool calls from the AI's answer. */
export function cleanToolCalls(raw: unknown): ToolCall[] {
  if (!Array.isArray(raw)) return [];
  const out: ToolCall[] = [];
  for (const item of raw) {
    const t = item as Partial<ToolCall> | null;
    if (!t || !TOOL_NAMES.includes(t.name as ToolName)) continue;
    const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
    const call: ToolCall = { name: t.name as ToolName };
    const query = text(t.query, 200);
    const url = text(t.url, 2000);
    const id = text(t.id, 200);
    const symbols = Array.isArray(t.symbols) ? t.symbols.filter((s): s is string => typeof s === 'string' && /^[\w.^=-]{1,15}$/.test(s.trim())).map((s) => s.trim().toUpperCase()) : [];
    if (query) call.query = query;
    if (url) call.url = url;
    if (id) call.id = id;
    if (symbols.length) call.symbols = symbols.slice(0, 10);
    if (STOCK_RANGES.includes(t.range as StockRange)) call.range = t.range as StockRange;
    if (typeof t.text === 'string' && t.text) call.text = t.text.slice(0, 2000);
    if (t.submit === true) call.submit = true;
    if (t.new_tab === true) call.new_tab = true;
    if (['up', 'down', 'top', 'bottom'].includes(t.direction as string)) call.direction = t.direction;
    // Page numbers can come back as numbers.
    if (!call.id && typeof (t as { id?: unknown }).id === 'number') call.id = String((t as { id?: unknown }).id);
    // Each tool needs its one thing.
    const needs: Record<ToolName, boolean> = {
      web_search: !!call.query,
      read_page: !!call.url,
      stock_history: !!call.symbols,
      portfolio_history: true,
      search_email: !!call.query,
      read_email: !!call.id,
      search_calendar: !!call.query,
      browser_read: true,
      browser_open: !!call.url && /^https?:\/\//i.test(call.url),
      browser_click: !!call.id,
      browser_type: !!call.id && call.text !== undefined,
      browser_scroll: true,
      browser_back: true,
    };
    if (needs[call.name]) out.push(call);
  }
  return out.slice(0, MAX_CALLS);
}

export const TOOL_LABEL: Record<ToolName, string> = {
  web_search: 'Searched the web',
  read_page: 'Read a page',
  stock_history: 'Checked stock prices',
  portfolio_history: 'Checked your portfolio',
  search_email: 'Searched your email',
  read_email: 'Read an email',
  search_calendar: 'Searched your calendar',
  browser_read: 'Read the page',
  browser_open: 'Opened',
  browser_click: 'Clicked',
  browser_type: 'Typed in',
  browser_scroll: 'Scrolled',
  browser_back: 'Went back',
};

/** What the tool is doing right now, for the line under the chat while it works. */
export const TOOL_DOING: Record<ToolName, string> = {
  web_search: 'Searching the web',
  read_page: 'Reading a page',
  stock_history: 'Checking stock prices',
  portfolio_history: 'Checking your portfolio',
  search_email: 'Searching your email',
  read_email: 'Reading an email',
  search_calendar: 'Searching your calendar',
  browser_read: 'Reading the page',
  browser_open: 'Opening',
  browser_click: 'Clicking',
  browser_type: 'Typing',
  browser_scroll: 'Scrolling',
  browser_back: 'Going back',
};

export const RANGE_WORDS: Record<StockRange, string> = {
  '5d': 'the last 5 days',
  '1mo': 'the last month',
  '3mo': 'the last 3 months',
  '6mo': 'the last 6 months',
  ytd: 'this year so far',
  '1y': 'the last year',
  '2y': 'the last 2 years',
  '5y': 'the last 5 years',
  max: 'all time',
};

/** Words for a tool call, shown under the label. */
export function toolDetail(call: ToolCall): string {
  switch (call.name) {
    case 'read_page':
    case 'browser_open':
      try {
        return new URL(call.url!).hostname.replace(/^www\./, '');
      } catch {
        return call.url ?? '';
      }
    case 'stock_history':
      return `${call.symbols!.join(', ')}, ${RANGE_WORDS[call.range ?? 'ytd']}`;
    case 'portfolio_history':
      return RANGE_WORDS[call.range ?? 'ytd'];
    case 'read_email':
    case 'browser_read':
    case 'browser_back':
      return '';
    case 'browser_click':
      return `[${call.id}]`;
    case 'browser_type':
      return `“${(call.text ?? '').slice(0, 40)}”`;
    case 'browser_scroll':
      return call.direction ?? 'down';
    default:
      return call.query ?? '';
  }
}

// ---- Reading what came back ----

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'", '#x2F': '/' };

export function decodeEntities(text: string): string {
  return text.replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (whole, code: string) => {
    if (ENTITIES[code] !== undefined) return ENTITIES[code];
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return whole;
  });
}

const stripTags = (html: string) =>
  decodeEntities(html.replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();

/** A web page's readable words: no scripts, styles, menus or tags. */
export function htmlToText(html: string, max = 12_000): { title: string; text: string } {
  const title = stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
  // Prefer the article itself when the page marks it.
  const main = html.match(/<(article|main)[\s>][\s\S]*?<\/\1>/i)?.[0] ?? html;
  const text = decodeEntities(
    main
      .replace(/<(script|style|noscript|svg|nav|footer|header|aside|form|iframe)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/(p|div|li|h[1-6]|tr|section|article|br)>|<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\f\v\r]+/g, ' ')
    .replace(/\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
  return { title, text: text.length > max ? `${text.slice(0, max)}…` : text };
}

export interface SearchResult extends Source {
  snippet: string;
}

/** Results from DuckDuckGo's plain HTML page. */
export function parseDuckDuckGo(html: string, limit = 6): SearchResult[] {
  const out: SearchResult[] = [];
  const links = [...html.matchAll(/<a\b[^>]*class="result__a"[^>]*>[\s\S]*?<\/a>/g)];
  links.forEach((m, i) => {
    if (out.length >= limit) return;
    const href = m[0].match(/href="([^"]+)"/)?.[1];
    if (!href) return;
    let url = decodeEntities(href);
    // DuckDuckGo wraps links in its own redirect.
    const wrapped = url.match(/[?&]uddg=([^&]+)/);
    if (wrapped) url = decodeURIComponent(wrapped[1]);
    if (url.startsWith('//')) url = `https:${url}`;
    // Skip its ads.
    if (!/^https?:\/\//.test(url) || /duckduckgo\.com\/y\.js/.test(url) || out.some((r) => r.url === url)) return;
    // The snippet sits between this result's link and the next one.
    const after = html.slice((m.index ?? 0) + m[0].length, links[i + 1]?.index ?? html.length);
    const snippet = stripTags(after.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/)?.[1] ?? '');
    out.push({ title: stripTags(m[0]) || url, url, snippet });
  });
  return out;
}

/** Headlines from a Google News RSS search. */
export function parseNewsRss(xml: string, limit = 6): SearchResult[] {
  const out: SearchResult[] = [];
  for (const item of xml.split('<item>').slice(1)) {
    const field = (tag: string) => {
      const raw = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))?.[1] ?? '';
      return stripTags(raw.replace(/^<!\[CDATA\[|\]\]>$/g, ''));
    };
    const title = field('title');
    const url = field('link');
    if (!title || !/^https?:\/\//.test(url)) continue;
    const date = field('pubDate');
    const source = field('source');
    out.push({ title, url, snippet: [source, date && new Date(date).toDateString()].filter(Boolean).join(', ') });
    if (out.length >= limit) break;
  }
  return out;
}

// ---- Stocks over time ----

export interface PriceHistory {
  symbol: string;
  name: string;
  /** The first and last closing prices in the range, and when. */
  start: number;
  startAt: number;
  end: number;
  endAt: number;
  high: number;
  low: number;
  changePct: number;
}

interface ChartJson {
  chart?: {
    result?: {
      meta?: { shortName?: string; longName?: string; regularMarketPrice?: number };
      timestamp?: number[];
      indicators?: { quote?: { close?: (number | null)[] }[]; adjclose?: { adjclose?: (number | null)[] }[] };
    }[];
  };
}

/** A ticker's price over a range, from Yahoo Finance's chart feed. Null when there's no data. */
export function parseHistory(json: unknown, symbol: string): PriceHistory | null {
  const result = (json as ChartJson)?.chart?.result?.[0];
  const times = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const points: { at: number; price: number }[] = [];
  times.forEach((t, i) => {
    const price = closes[i];
    if (typeof price === 'number' && Number.isFinite(price) && price > 0) points.push({ at: t * 1000, price });
  });
  if (points.length === 0) return null;
  const live = result?.meta?.regularMarketPrice;
  const first = points[0];
  const last = points[points.length - 1];
  const end = typeof live === 'number' && live > 0 ? live : last.price;
  const prices = points.map((p) => p.price);
  return {
    symbol,
    name: (result?.meta?.shortName || result?.meta?.longName || symbol).replace(/\s+USD$/, ''),
    start: first.price,
    startAt: first.at,
    end,
    endAt: last.at,
    high: Math.max(...prices, end),
    low: Math.min(...prices, end),
    changePct: ((end - first.price) / first.price) * 100,
  };
}

const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
const day = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** One ticker's history in words for the AI. */
export function describeHistory(h: PriceHistory, range: StockRange): string {
  return `${h.symbol} (${h.name}) over ${RANGE_WORDS[range]}: ${money(h.start)} on ${day(h.startAt)} → ${money(h.end)} now, ${pct(h.changePct)}. High ${money(h.high)}, low ${money(h.low)}.`;
}

/**
 * How the stocks they own did over a range, counting the shares they own
 * now as if they'd held them the whole time (Life Hub doesn't know when they bought).
 */
export function describePortfolioHistory(holdings: { symbol: string; shares: number }[], histories: Record<string, PriceHistory | null>, range: StockRange): string {
  const lines: string[] = [];
  let startTotal = 0;
  let endTotal = 0;
  for (const h of holdings) {
    const hist = histories[h.symbol];
    if (!hist) {
      lines.push(`${h.symbol}: no price history found.`);
      continue;
    }
    const start = hist.start * h.shares;
    const end = hist.end * h.shares;
    startTotal += start;
    endTotal += end;
    lines.push(`${h.symbol}, ${h.shares} shares: ${money(start)} → ${money(end)} (${money(end - start)}, ${pct(hist.changePct)}). Price ${money(hist.start)} on ${day(hist.startAt)} → ${money(hist.end)}.`);
  }
  if (holdings.length === 0) return "They haven't added any stocks to Life Hub.";
  const change = endTotal - startTotal;
  const total = startTotal > 0 ? `Total over ${RANGE_WORDS[range]}: ${money(startTotal)} → ${money(endTotal)}, ${money(change)} (${pct((change / startTotal) * 100)}).` : '';
  return [
    total,
    ...lines,
    'This counts the shares they own now as if they held them for the whole range; Life Hub doesn’t know when they bought, so say that briefly if it matters.',
  ]
    .filter(Boolean)
    .join('\n');
}
