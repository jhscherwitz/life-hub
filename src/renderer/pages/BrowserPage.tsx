import { useEffect, useRef, useState, type FormEvent } from 'react';
import { addressFor, shortAddress } from '../../shared/browser';
import { Icon } from '../components/Icon';
import { Spark } from './ChatPage';

// Life Hub's browser, laid out like Zen: your tabs run down the left (they
// take the menu's place while you browse), and the page floats in the middle
// as a rounded card. The AI can read and use the page you're on, and
// highlighting text gives an "Ask AI" button (see electron/browser.ts).

/** The parts of Electron's <webview> this page uses. */
interface Webview extends HTMLElement {
  loadURL(url: string): Promise<void>;
  goBack(): void;
  goForward(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  reload(): void;
  stop(): void;
  getURL(): string;
  getTitle(): string;
  getWebContentsId(): number;
}

export interface Tab {
  key: number;
  /** The address the tab opened with ('' for the start page, until you go somewhere). */
  start: string;
  url: string;
  title: string;
  loading: boolean;
  canBack: boolean;
  canForward: boolean;
  /** The page's id in the app, once it's loaded, so the AI can use it. */
  pageId?: number;
}

const SHORTCUTS = [
  { name: 'Google', url: 'https://www.google.com', color: '#4285f4' },
  { name: 'YouTube', url: 'https://www.youtube.com', color: '#ff3d3d' },
  { name: 'Gmail', url: 'https://mail.google.com', color: '#ea4335' },
  { name: 'Drive', url: 'https://drive.google.com', color: '#1fa463' },
  { name: 'Wikipedia', url: 'https://en.wikipedia.org', color: '#8a8a8a' },
  { name: 'Reddit', url: 'https://www.reddit.com', color: '#ff5700' },
];

let nextKey = 1;
const newTab = (start = ''): Tab => ({ key: nextKey++, start, url: start, title: start ? shortAddress(start) : 'New tab', loading: !!start, canBack: false, canForward: false });

/** A letter and colour for a tab, since pages' own icons can't be shown in the installed app. */
function tabBadge(tab: Tab): { letter: string; hue: number } {
  let host = '';
  try {
    host = new URL(tab.url).hostname.replace(/^www\./, '');
  } catch {
    // The start page.
  }
  if (!host) return { letter: '+', hue: 0 };
  let hash = 0;
  for (const c of host) hash = (hash * 31 + c.charCodeAt(0)) % 360;
  return { letter: host[0].toUpperCase(), hue: hash };
}

export type Browser = ReturnType<typeof useBrowser>;

/** The browser's tabs and what you can do with them. Lives in the dashboard so the tabs survive switching pages. */
export function useBrowser({ visible, open }: { visible: boolean; open: { url: string; n: number } | null }) {
  // Opened for a link or the AI: start on that page instead of a blank tab.
  const [tabs, setTabs] = useState<Tab[]>(() => [newTab(open?.url ?? '')]);
  const [activeKey, setActiveKey] = useState(tabs[0].key);
  const handled = useRef(open?.n);
  const views = useRef<HTMLDivElement>(null);
  const address = useRef<HTMLInputElement>(null);
  const active = tabs.find((t) => t.key === activeKey) ?? tabs[0];

  const view = (key = activeKey) => views.current?.querySelector<Webview>(`[data-tab="${key}"] webview`) ?? null;
  const patch = (key: number, p: Partial<Tab>) => setTabs((list) => list.map((t) => (t.key === key ? { ...t, ...p } : t)));

  const go = (typed: string) => {
    const url = addressFor(typed);
    if (!url) return;
    if (!active.start) patch(active.key, { start: url, url, title: shortAddress(url), loading: true });
    else void view()?.loadURL(url).catch(() => undefined);
    address.current?.blur();
  };

  const addTab = (start = '') => {
    const tab = newTab(start);
    // A page opened while the only tab is blank takes that tab's place.
    setTabs((list) => (start && list.length === 1 && !list[0].start ? [tab] : [...list, tab]));
    setActiveKey(tab.key);
    if (!start) setTimeout(() => address.current?.focus(), 60);
  };

  const closeTab = (key: number) => {
    setTabs((list) => {
      if (list.length === 1) {
        const fresh = newTab();
        setActiveKey(fresh.key);
        return [fresh];
      }
      const at = list.findIndex((t) => t.key === key);
      const rest = list.filter((t) => t.key !== key);
      if (key === activeKey) setActiveKey(rest[Math.min(at, rest.length - 1)].key);
      return rest;
    });
  };

  // Tell the app which page is in front, so the AI uses the right one.
  useEffect(() => {
    void window.hub.browserActive?.(active.start ? (active.pageId ?? null) : null);
  }, [active.key, active.pageId, active.start]);

  // New tabs asked for by links and by the AI.
  useEffect(() => {
    if (!open || open.n === handled.current) return;
    handled.current = open.n;
    addTab(open.url);
  }, [open?.n]);

  // Ctrl+T, Ctrl+W, Ctrl+L, Ctrl+R / F5, Alt+arrows: from the page, or from Life Hub.
  const keys = useRef<(key: string) => void>(() => undefined);
  keys.current = (key: string) => {
    if (!visible) return;
    if (key === 't') addTab();
    else if (key === 'w') closeTab(activeKey);
    else if (key === 'l') address.current?.select();
    else if (key === 'r') view()?.reload();
    else if (key === 'back') view()?.goBack();
    else if (key === 'forward') view()?.goForward();
  };
  useEffect(() => window.hub.onBrowserKey?.((key) => keys.current(key)), []);
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const shortcut = (mod && ['t', 'w', 'l', 'r'].includes(key) && key) || (key === 'f5' && 'r');
      if (!shortcut) return;
      e.preventDefault();
      keys.current(shortcut);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible]);

  return {
    tabs,
    active,
    activeKey,
    views,
    address,
    select: (key: number) => setActiveKey(key),
    go,
    addTab,
    closeTab,
    patch,
    back: () => view()?.goBack(),
    forward: () => view()?.goForward(),
    reload: () => (active.loading ? view()?.stop() : view()?.reload()),
  };
}

/** One tab's page. It stays loaded while you look at other tabs and pages. */
function TabView({ tab, onChange }: { tab: Tab; onChange: (patch: Partial<Tab>) => void }) {
  const ref = useRef<Webview | null>(null);
  const change = useRef(onChange);
  change.current = onChange;

  useEffect(() => {
    const view = ref.current;
    if (!view) return;
    const sync = () => {
      try {
        change.current({ url: view.getURL(), title: view.getTitle() || shortAddress(view.getURL()), canBack: view.canGoBack(), canForward: view.canGoForward() });
      } catch {
        // Not ready yet.
      }
    };
    const handlers: [string, EventListener][] = [
      ['dom-ready', () => (sync(), change.current({ pageId: view.getWebContentsId() }))],
      ['did-start-loading', () => change.current({ loading: true })],
      ['did-stop-loading', () => (sync(), change.current({ loading: false }))],
      ['did-navigate', sync],
      ['did-navigate-in-page', sync],
      ['page-title-updated', sync],
    ];
    for (const [name, fn] of handlers) view.addEventListener(name, fn);
    return () => {
      for (const [name, fn] of handlers) view.removeEventListener(name, fn);
    };
  }, []);

  return <webview ref={ref as never} className="browser-view" src={tab.start} partition="persist:browser" allowpopups={"true" as unknown as boolean} />;
}

/**
 * The left side while browsing, like Zen: back, forward and reload, the
 * address, and your tabs running down the side.
 */
export function BrowserTabs({ b }: { b: Browser }) {
  const [typed, setTyped] = useState<string | null>(null);
  const { active } = b;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    b.go(typed ?? active.url);
    setTyped(null);
  };
  return (
    <div className="zen">
      <div className="zen-nav">
        <button className="zen-btn" disabled={!active.canBack} onClick={b.back} aria-label="Back" title="Back (Alt+←)">
          <Icon name="back" size={15} />
        </button>
        <button className="zen-btn" disabled={!active.canForward} onClick={b.forward} aria-label="Forward" title="Forward (Alt+→)">
          <Icon name="chevron" size={15} />
        </button>
        <button className="zen-btn" disabled={!active.start} onClick={b.reload} aria-label={active.loading ? 'Stop' : 'Reload'} title={active.loading ? 'Stop' : 'Reload (Ctrl+R)'}>
          <Icon name={active.loading ? 'x' : 'refresh'} size={14} />
        </button>
      </div>
      <form className="zen-address" onSubmit={submit}>
        <Icon name={active.url.startsWith('https://') ? 'lock' : 'search'} size={12} />
        <input
          ref={b.address}
          value={typed ?? (active.start ? shortAddress(active.url) : '')}
          onChange={(e) => setTyped(e.target.value)}
          onFocus={(e) => {
            if (typed === null) setTyped(active.start ? active.url : '');
            requestAnimationFrame(() => e.target.select());
          }}
          onBlur={() => setTyped(null)}
          onKeyDown={(e) => e.key === 'Escape' && (setTyped(null), e.currentTarget.blur())}
          placeholder="Search or type an address"
          spellCheck={false}
        />
      </form>
      <div className="zen-tabs" role="tablist">
        {b.tabs.map((t) => {
          const badge = tabBadge(t);
          return (
            <div
              key={t.key}
              className={`zen-tab ${t.key === b.activeKey ? 'is-active' : ''}`}
              role="tab"
              aria-selected={t.key === b.activeKey}
              onMouseDown={(e) => {
                // Middle click closes, like a normal browser.
                if (e.button === 1) {
                  e.preventDefault();
                  b.closeTab(t.key);
                }
              }}
            >
              <button className="zen-tab-main" onClick={() => b.select(t.key)} title={t.url || 'New tab'}>
                {t.loading ? (
                  <span className="browser-spinner" aria-hidden="true" />
                ) : (
                  <span className="zen-badge" style={{ background: badge.letter === '+' ? undefined : `hsl(${badge.hue} 55% 42%)` }}>
                    {badge.letter}
                  </span>
                )}
                <span className="zen-tab-title">{t.title || 'New tab'}</span>
              </button>
              <button className="zen-tab-close" onClick={() => b.closeTab(t.key)} aria-label="Close tab" title="Close tab (Ctrl+W)">
                <Icon name="x" size={11} />
              </button>
            </div>
          );
        })}
        <button className="zen-new" onClick={() => b.addTab()} title="New tab (Ctrl+T)">
          <Icon name="plus" size={14} />
          New tab
        </button>
      </div>
    </div>
  );
}

/** The page itself, floating in the middle as a rounded card. */
export function BrowserView({ b, visible, onAskAboutPage }: { b: Browser; visible: boolean; onAskAboutPage: () => void }) {
  const { active } = b;
  return (
    <section className={`browser ${visible ? '' : 'is-hidden'}`} aria-hidden={!visible}>
      <header className="browser-top">
        <span className="browser-top-title" title={active.url}>
          {active.start ? active.title : 'New tab'}
        </span>
        <button className="browser-ask" disabled={!active.start} onClick={onAskAboutPage} title="Ask Life Hub AI about this page">
          <Spark size={14} />
          Ask AI about this page
        </button>
        <button className="zen-btn" disabled={!active.start} onClick={() => window.open(active.url, '_blank')} aria-label="Open in your browser" title="Open in your usual browser">
          <Icon name="external" size={14} />
        </button>
      </header>
      <div className="browser-card" ref={b.views}>
        {b.tabs.map((t) =>
          t.start ? (
            <div key={t.key} data-tab={t.key} className={`browser-frame ${t.key === b.activeKey ? 'is-active' : ''}`}>
              <TabView tab={t} onChange={(p) => b.patch(t.key, p)} />
            </div>
          ) : (
            t.key === b.activeKey && (
              <div key={t.key} className="browser-start">
                <Spark size={34} />
                <h2>Where to?</h2>
                <form
                  className="browser-start-search"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const q = new FormData(e.currentTarget).get('q');
                    if (typeof q === 'string') b.go(q);
                  }}
                >
                  <Icon name="search" size={16} />
                  <input name="q" placeholder="Search Google or type an address" autoFocus={visible} spellCheck={false} />
                </form>
                <div className="browser-shortcuts">
                  {SHORTCUTS.map((s) => (
                    <button key={s.url} onClick={() => b.go(s.url)}>
                      <span className="browser-shortcut-icon" style={{ background: s.color }}>
                        {s.name[0]}
                      </span>
                      {s.name}
                    </button>
                  ))}
                </div>
                <p className="browser-start-tip">
                  Highlight text on any page for <b>Ask AI</b>, or ask the AI to read the page, open sites, and click or fill things in for you.
                </p>
              </div>
            )
          ),
        )}
      </div>
    </section>
  );
}
