import {
  TOOL_LABEL,
  describeHistory,
  describePortfolioHistory,
  htmlToText,
  parseDuckDuckGo,
  parseHistory,
  parseNewsRss,
  toolDetail,
  type PriceHistory,
  type SearchResult,
  type StockRange,
  type ToolCall,
  type ToolStep,
} from '../../src/shared/tools';
import type { CalendarEvent, EmailMessage } from '../../src/shared/types';
import { formatTime } from '../../src/shared/time';
import type { AiWriter, WebAnswer } from '../ai/types';
import type { EmailSource, CalendarSource } from '../sources/types';
import type { JsonFile } from './store';

/** Gemini searches a day. Well under Google's free allowance, so it never costs anything. */
export const GEMINI_SEARCHES_PER_DAY = 60;
/** Biggest page Life Hub will read for the AI. */
const PAGE_BYTES = 2_000_000;

export interface ToolDeps {
  writer: AiWriter;
  /** fetch() for the web; a parameter so tests can fake it. */
  fetch: typeof fetch;
  /** Browser-like User-Agent, since some sites turn away anything else. */
  userAgent: string;
  /** A ticker's chart from Yahoo Finance (range and daily prices). */
  chart: (symbol: string, range: StockRange) => Promise<unknown>;
  holdings: () => { symbol: string; shares: number }[];
  email: EmailSource;
  calendar: CalendarSource;
  /** Counts today's Gemini searches. */
  searchCount: JsonFile<{ date: string; count: number }>;
  /** Life Hub's browser (see electron/browser.ts). */
  browser?: BrowserTools;
  /** Today's top stories (the News widget's feed). */
  news?: () => Promise<{ stories: { title: string; source: string; big?: string; publishedAt: string }[] }>;
  now?: Date;
}

/** What the AI can do in Life Hub's browser. */
export interface BrowserTools {
  /** The page open now, in words, or null. */
  status(): string | null;
  read(): Promise<{ text: string; title: string; url: string }>;
  open(url: string, newTab: boolean): Promise<{ title: string; url: string }>;
  /** Clicks a numbered thing from read(); gives back its words. */
  click(id: string): Promise<string>;
  type(id: string, text: string, submit: boolean): Promise<string>;
  scroll(direction: 'up' | 'down' | 'top' | 'bottom'): Promise<void>;
  back(): Promise<{ title: string; url: string }>;
}

const pageLine = (p: { title: string; url: string }) => `Now on: ${p.title || 'a page'} (${p.url}). Use browser_read to see it.`;

export interface ToolOutcome {
  /** What the AI reads. */
  text: string;
  step: ToolStep;
}

/**
 * Pages on this computer or the home network are off limits, so a web page
 * can't trick the AI into poking at them.
 */
export function isPublicUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host.includes('.') || /\.(local|localhost|internal|lan|home|corp)$/.test(host)) return false;
  if (host.includes(':')) return false; // IPv6 literals
  const ip = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ip) {
    const [a, b] = [Number(ip[1]), Number(ip[2])];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
  }
  return true;
}

async function getText(deps: ToolDeps, url: string, accept: string): Promise<string> {
  let res: Response | null = null;
  // Redirects are followed by hand, so each stop is checked too.
  for (let hop = 0; hop < 5; hop++) {
    if (!isPublicUrl(url)) throw new Error('Life Hub only reads public web pages.');
    res = await deps.fetch(url, {
      headers: { 'User-Agent': deps.userAgent, Accept: accept, 'Accept-Language': 'en-US,en;q=0.9' },
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
    const next = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!next) break;
    url = new URL(next, url).toString();
    res = null;
  }
  if (!res) throw new Error('That page kept redirecting.');
  if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  if (type && !/text|html|xml|json/.test(type)) throw new Error("That isn't a page Life Hub can read (it's a file).");
  const length = Number(res.headers.get('content-length') ?? 0);
  if (length > PAGE_BYTES) throw new Error('That page is too big to read.');
  const text = await res.text();
  return text.slice(0, PAGE_BYTES);
}

const today = (now: Date) => now.toISOString().slice(0, 10);

/** Gemini's own Google Search, while today's allowance lasts. */
async function geminiSearch(deps: ToolDeps, query: string): Promise<WebAnswer | null> {
  if (!deps.writer.search) return null;
  const date = today(deps.now ?? new Date());
  const used = deps.searchCount.read();
  const count = used.date === date ? used.count : 0;
  if (count >= GEMINI_SEARCHES_PER_DAY) return null;
  deps.searchCount.write({ date, count: count + 1 });
  try {
    return await deps.writer.search(query);
  } catch {
    return null;
  }
}

function resultsText(results: SearchResult[]): string {
  return results.map((r, i) => `${i + 1}. ${r.title}\n${r.url}${r.snippet ? `\n${r.snippet}` : ''}`).join('\n\n');
}

async function webSearch(deps: ToolDeps, query: string): Promise<{ text: string; sources: { title: string; url: string }[] }> {
  const gemini = await geminiSearch(deps, query);
  if (gemini?.answer) {
    return {
      text: `Google Search answer:\n${gemini.answer}${gemini.sources.length ? `\n\nSources: ${gemini.sources.map((s) => s.title).join(', ')}` : ''}`,
      sources: gemini.sources,
    };
  }
  // Free searches with no key: DuckDuckGo, then Google News headlines.
  const results: SearchResult[] = [];
  try {
    const html = await getText(deps, `https://html.duckduckgo.com/html/?${new URLSearchParams({ q: query })}`, 'text/html');
    results.push(...parseDuckDuckGo(html));
  } catch {
    // Try the news below.
  }
  try {
    const xml = await getText(deps, `https://news.google.com/rss/search?${new URLSearchParams({ q: query, hl: 'en-US', gl: 'US', ceid: 'US:en' })}`, 'application/rss+xml');
    results.push(...parseNewsRss(xml, results.length ? 4 : 8));
  } catch {
    // Nothing more to try.
  }
  if (results.length === 0) throw new Error('The web search found nothing (or couldn’t be reached).');
  return {
    text: `Search results (use read_page on one to read it in full):\n\n${resultsText(results)}`,
    sources: results.map(({ title, url }) => ({ title, url })),
  };
}

function eventLine(e: CalendarEvent): string {
  const d = new Date(e.start);
  const when = `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}${e.allDay ? ', all day' : ` ${formatTime(e.start)}`}`;
  return `${when}: ${e.title}${e.location ? ` (at ${e.location})` : ''}${e.ref ? ` [event ${e.ref}]` : ''}`;
}

function emailLine(m: EmailMessage): string {
  return `[id ${m.threadId ?? m.id}] ${m.receivedAt.slice(0, 10)} from ${m.from.name || m.from.email}: "${m.subject}"${m.unsubscribe ? ' (can unsubscribe)' : ''}. ${m.snippet}`;
}

/** The browser tools. Things the AI reads on pages are information, never orders (see the chat rules). */
async function runBrowserTool(call: ToolCall, step: ToolStep, deps: ToolDeps): Promise<ToolOutcome> {
  const browser = deps.browser;
  if (!browser) throw new Error("Life Hub's browser isn't available.");
  switch (call.name) {
    case 'browser_read': {
      const page = await browser.read();
      return { text: page.text, step: { ...step, detail: page.title || hostOf(page.url), sources: [{ title: page.title || page.url, url: page.url }] } };
    }
    case 'browser_open': {
      const page = await browser.open(call.url!, call.new_tab === true);
      return { text: pageLine(page), step: { ...step, detail: page.title || hostOf(page.url) } };
    }
    case 'browser_click': {
      const what = await browser.click(call.id!);
      return { text: `Clicked ${what}. ${browser.status() ? `Now on: ${browser.status()}. ` : ''}Use browser_read to see what changed.`, step: { ...step, detail: what.slice(0, 60) } };
    }
    case 'browser_type': {
      const where = await browser.type(call.id!, call.text ?? '', call.submit === true);
      return {
        text: `Typed "${call.text}" in ${where}${call.submit ? ' and pressed Enter' : ''}. ${browser.status() ? `Now on: ${browser.status()}. ` : ''}Use browser_read to see the result.`,
        step,
      };
    }
    case 'browser_scroll':
      await browser.scroll(call.direction ?? 'down');
      return { text: 'Scrolled. Use browser_read to see what is there now.', step };
    case 'browser_back':
      return { text: pageLine(await browser.back()), step };
    default:
      throw new Error('Unknown tool.');
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Runs one tool. Never throws: a failure is something the AI should hear about. */
export async function runTool(call: ToolCall, deps: ToolDeps): Promise<ToolOutcome> {
  const step: ToolStep = { name: call.name, label: TOOL_LABEL[call.name], detail: toolDetail(call), ok: true };
  try {
    switch (call.name) {
      case 'web_search': {
        const { text, sources } = await webSearch(deps, call.query!);
        return { text, step: { ...step, ...(sources.length && { sources }) } };
      }
      case 'read_page': {
        const page = htmlToText(await getText(deps, call.url!, 'text/html,application/xhtml+xml'));
        if (!page.text) throw new Error('That page had no words Life Hub could read (it may need JavaScript or a sign-in).');
        return {
          text: `${page.title ? `${page.title}\n` : ''}${page.text}`,
          step: { ...step, sources: [{ title: page.title || step.detail, url: call.url! }] },
        };
      }
      case 'stock_history': {
        const range = call.range ?? 'ytd';
        const lines = await Promise.all(
          call.symbols!.map(async (symbol) => {
            try {
              const h = parseHistory(await deps.chart(symbol, range), symbol);
              return h ? describeHistory(h, range) : `${symbol}: no price history found.`;
            } catch {
              return `${symbol}: couldn't get prices right now.`;
            }
          }),
        );
        return { text: lines.join('\n'), step };
      }
      case 'portfolio_history': {
        const range = call.range ?? 'ytd';
        const holdings = deps.holdings();
        const histories: Record<string, PriceHistory | null> = {};
        await Promise.all(
          holdings.map(async (h) => {
            try {
              histories[h.symbol] = parseHistory(await deps.chart(h.symbol, range), h.symbol);
            } catch {
              histories[h.symbol] = null;
            }
          }),
        );
        return { text: describePortfolioHistory(holdings, histories, range), step };
      }
      case 'search_email': {
        if (!deps.email.search) throw new Error('Sign in to Google in Settings so the AI can search your email.');
        const found = await deps.email.search(call.query!, 10);
        return { text: found.length ? `${found.map(emailLine).join('\n')}\n\n(Use read_email with an id to read one in full.)` : 'No emails matched.', step };
      }
      case 'read_email': {
        const m = await deps.email.getMessage(call.id!);
        step.detail = m.subject;
        return { text: `From ${m.from.name} <${m.from.email}>, ${m.receivedAt}\nSubject: ${m.subject}\n\n${m.body.slice(0, 8000)}`, step };
      }
      case 'calendar_days': {
        const [y, m, d] = call.start!.split('-').map(Number);
        const start = new Date(y, m - 1, d);
        const end = new Date(y, m - 1, d + (call.days ?? 1));
        const events = (await deps.calendar.listEvents({ start, end })).sort((a, b) => a.start.localeCompare(b.start));
        return { text: events.length ? events.map(eventLine).join('\n') : 'Nothing on the calendar those days.', step };
      }
      case 'top_news': {
        if (!deps.news) throw new Error("The news isn't available right now.");
        const view = await deps.news();
        const lines = view.stories.slice(0, 15).map((s) => `- ${s.big ? `[BIG: ${s.big}] ` : ''}${s.title} (${s.source})`);
        return { text: lines.length ? `Today's top stories (Google News):\n${lines.join('\n')}\n\nUse web_search or read_page for more on one.` : 'No news right now.', step };
      }
      case 'search_calendar': {
        if (!deps.calendar.search) throw new Error('Sign in to Google in Settings so the AI can search your calendar.');
        const found = await deps.calendar.search(call.query!, 15);
        return { text: found.length ? found.map(eventLine).join('\n') : 'No events matched.', step };
      }
      default:
        return await runBrowserTool(call, step, deps);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { text: `That didn't work: ${message}`, step: { ...step, ok: false } };
  }
}
