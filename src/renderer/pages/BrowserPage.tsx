import { useEffect, useRef, useState, type FocusEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';
import { addressFor, originOf, shortAddress, type Bookmark, type PasswordPrompt, type Suggestion } from '../../shared/browser';
import { Icon } from '../components/Icon';
import { Spark } from './ChatPage';

// Life Hub's browser, laid out like Zen: your tabs run down the left (they
// take the menu's place while you browse), with pinned sites as tiles above
// them, and the page floats in the middle as a rounded card. It remembers your
// tabs, history, bookmarks and passwords like Chrome. The AI can read and use
// the page you're on, and highlighting text gives an "Ask AI" button (see
// electron/browser.ts).

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
  /** Brought back from last time and not looked at yet: it loads when you open it. */
  sleeping?: boolean;
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
const newTab = (start = '', title = '', sleeping = false): Tab => ({
  key: nextKey++,
  start,
  url: start,
  title: title || (start ? shortAddress(start) : 'New tab'),
  loading: !!start && !sleeping,
  canBack: false,
  canForward: false,
  ...(sleeping && { sleeping }),
});

/** A letter and colour for a site, since pages' own icons can't be shown in the installed app. */
function badge(url: string): { letter: string; color?: string } {
  let host = '';
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    // The start page.
  }
  if (!host) return { letter: '+' };
  let hash = 0;
  for (const c of host) hash = (hash * 31 + c.charCodeAt(0)) % 360;
  return { letter: host[0].toUpperCase(), color: `hsl(${hash} 55% 42%)` };
}

function Badge({ url, big = false }: { url: string; big?: boolean }) {
  const b = badge(url);
  return (
    <span className={`zen-badge ${big ? 'is-big' : ''}`} style={b.color ? { background: b.color } : undefined}>
      {b.letter}
    </span>
  );
}

export type Browser = ReturnType<typeof useBrowser>;

/** The browser's tabs, bookmarks and what you can do with them. Lives in the dashboard so the tabs survive switching pages. */
export function useBrowser({ visible, open }: { visible: boolean; open: { url: string; n: number } | null }) {
  // Opened for a link or the AI: start on that page instead of a blank tab.
  const [tabs, setTabs] = useState<Tab[]>(() => [newTab(open?.url ?? '')]);
  const [activeKey, setActiveKey] = useState(tabs[0].key);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [restored, setRestored] = useState(false);
  const handled = useRef(open?.n);
  const views = useRef<HTMLDivElement>(null);
  const address = useRef<HTMLInputElement>(null);
  const active = tabs.find((t) => t.key === activeKey) ?? tabs[0];

  const view = (key = activeKey) => views.current?.querySelector<Webview>(`[data-tab="${key}"] webview`) ?? null;
  const patch = (key: number, p: Partial<Tab>) => setTabs((list) => list.map((t) => (t.key === key ? { ...t, ...p } : t)));

  // Bring back last time's tabs (each loads when you open it) and the bookmarks.
  useEffect(() => {
    let alive = true;
    void window.hub.browserBookmarks?.().then((b) => alive && Array.isArray(b) && setBookmarks(b));
    const session = window.hub.browserSession?.();
    if (!session) {
      setRestored(true);
      return;
    }
    void session
      .then((s) => {
        if (!alive) return;
        setTabs((list) => {
          // Only if nothing's happened in the browser yet.
          if (list.length !== 1 || list[0].start || !Array.isArray(s?.tabs) || !s.tabs.length) return list;
          const back = s.tabs.map((t, i) => newTab(t.url, t.title, i !== s.active && !!t.url));
          setActiveKey(back[Math.min(s.active, back.length - 1)].key);
          return back;
        });
      })
      .finally(() => alive && setRestored(true));
    return () => {
      alive = false;
    };
  }, []);

  // Remember the open tabs for next time.
  useEffect(() => {
    if (!restored) return;
    const timer = setTimeout(() => {
      void window.hub.browserSaveSession?.({
        tabs: tabs.map((t) => ({ url: t.start ? t.url : '', title: t.start ? t.title : '' })),
        active: Math.max(0, tabs.findIndex((t) => t.key === activeKey)),
      });
    }, 800);
    return () => clearTimeout(timer);
  }, [tabs, activeKey, restored]);

  const go = (typed: string) => {
    const url = addressFor(typed);
    if (!url) return;
    if (!active.start || active.sleeping) patch(active.key, { start: url, url, title: shortAddress(url), loading: true, sleeping: undefined });
    else void view()?.loadURL(url).catch(() => undefined);
    address.current?.blur();
  };

  const select = (key: number) => {
    setActiveKey(key);
    setTabs((list) => list.map((t) => (t.key === key && t.sleeping ? { ...t, sleeping: undefined, loading: true } : t)));
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
      if (key === activeKey) {
        const next = rest[Math.min(at, rest.length - 1)];
        setActiveKey(next.key);
        if (next.sleeping) return rest.map((t) => (t.key === next.key ? { ...t, sleeping: undefined, loading: true } : t));
      }
      return rest;
    });
  };

  /** A pinned site: go to its tab if it's open, else open it. */
  const openSite = (url: string) => {
    const origin = originOf(url);
    const open = tabs.find((t) => t.start && originOf(t.url) === origin);
    if (open) return select(open.key);
    if (!active.start) return go(url);
    addTab(url);
  };

  const bookmarked = (url: string) => bookmarks.find((b) => b.url === url);

  // Tell the app which page is in front, so the AI uses the right one.
  useEffect(() => {
    void window.hub.browserActive?.(active.start && !active.sleeping ? (active.pageId ?? null) : null);
  }, [active.key, active.pageId, active.start, active.sleeping]);

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
    bookmarks,
    select,
    go,
    addTab,
    closeTab,
    patch,
    openSite,
    bookmarked,
    toggleStar: async (url: string, title: string) => setBookmarks(await window.hub.browserToggleBookmark(url, title)),
    setPinned: async (url: string, title: string, pinned: boolean) => setBookmarks(await window.hub.browserPin(url, title, pinned)),
    removeBookmark: async (url: string) => setBookmarks(await window.hub.browserRemoveBookmark(url)),
    importBookmarks: async () => {
      const r = await window.hub.browserImportBookmarks();
      setBookmarks(r.bookmarks);
      return r.added;
    },
    back: () => view()?.goBack(),
    forward: () => view()?.goForward(),
    reload: () => (active.loading ? view()?.stop() : view()?.reload()),
  };
}

/** Suggestions from your history and bookmarks for what's typed. */
function useSuggestions(text: string | null): Suggestion[] {
  const [list, setList] = useState<Suggestion[]>([]);
  useEffect(() => {
    if (!text?.trim() || typeof window.hub.browserSuggest !== 'function') {
      setList([]);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => void window.hub.browserSuggest(text).then((s) => alive && setList(s)), 80);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [text]);
  return list;
}

/** A search box with suggestions under it; arrow keys move, Enter goes. */
function AddressBox({
  inputRef,
  value,
  onType,
  onGo,
  className,
  placeholder,
  icon,
  autoFocus,
  onFocus,
  onBlur,
}: {
  inputRef?: RefObject<HTMLInputElement | null>;
  value: string;
  onType: (text: string | null) => void;
  onGo: (text: string) => void;
  className: string;
  placeholder: string;
  icon: ReactNode;
  autoFocus?: boolean;
  onFocus?: (e: FocusEvent<HTMLInputElement>) => void;
  onBlur?: () => void;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  const [pick, setPick] = useState(-1);
  const suggestions = useSuggestions(typed);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const chosen = pick >= 0 ? suggestions[pick]?.url : null;
    onGo(chosen ?? value);
    setTyped(null);
    setPick(-1);
  };
  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && suggestions.length) {
      e.preventDefault();
      setPick((p) => Math.min(suggestions.length - 1, p + 1));
    } else if (e.key === 'ArrowUp' && suggestions.length) {
      e.preventDefault();
      setPick((p) => Math.max(-1, p - 1));
    } else if (e.key === 'Escape') {
      setTyped(null);
      onType(null);
      e.currentTarget.blur();
    }
  };
  return (
    <form className={className} onSubmit={submit}>
      {icon}
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          setTyped(e.target.value);
          setPick(-1);
          onType(e.target.value);
        }}
        onKeyDown={onKey}
        onFocus={onFocus}
        onBlur={() => {
          // Let a click on a suggestion land first.
          setTimeout(() => {
            setTyped(null);
            setPick(-1);
            onBlur?.();
          }, 120);
        }}
        placeholder={placeholder}
        spellCheck={false}
        autoFocus={autoFocus}
      />
      {suggestions.length > 0 && typed !== null && (
        <ul className="suggest" role="listbox">
          {suggestions.map((s, i) => (
            <li key={s.url} role="option" aria-selected={i === pick}>
              <button
                type="button"
                className={i === pick ? 'is-picked' : ''}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onGo(s.url);
                  setTyped(null);
                }}
              >
                <Icon name={s.kind === 'bookmark' ? 'star' : 'clock'} size={12} />
                <span className="suggest-title">{s.title || shortAddress(s.url)}</span>
                <span className="suggest-url">{shortAddress(s.url)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}

/**
 * The left side while browsing, like Zen: pinned sites as tiles, back,
 * forward and reload, the address, and your tabs running down the side.
 */
export function BrowserTabs({ b }: { b: Browser }) {
  const [typed, setTyped] = useState<string | null>(null);
  const { active } = b;
  const pins = b.bookmarks.filter((x) => x.pinned);
  return (
    <div className="zen">
      {pins.length > 0 && (
        <div className="zen-pins">
          {pins.slice(0, 12).map((p) => {
            const isOpen = !!active.start && originOf(active.url) === originOf(p.url);
            return (
              <div key={p.url} className={`zen-pin ${isOpen ? 'is-active' : ''}`}>
                <button className="zen-pin-main" onClick={() => b.openSite(p.url)} title={p.title || p.url}>
                  <Badge url={p.url} big />
                </button>
                <button className="zen-pin-off" onClick={() => void b.setPinned(p.url, p.title, false)} aria-label={`Unpin ${p.title}`} title="Unpin">
                  <Icon name="x" size={9} />
                </button>
              </div>
            );
          })}
        </div>
      )}
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
      <AddressBox
        className="zen-address"
        inputRef={b.address}
        value={typed ?? (active.start ? shortAddress(active.url) : '')}
        onType={setTyped}
        onGo={(text) => {
          b.go(text);
          setTyped(null);
        }}
        onFocus={(e) => {
          if (typed === null) setTyped(active.start ? active.url : '');
          const input = e.target;
          requestAnimationFrame(() => input.select());
        }}
        onBlur={() => setTyped(null)}
        placeholder="Search or type an address"
        icon={<Icon name={active.url.startsWith('https://') ? 'lock' : 'search'} size={12} />}
      />
      <div className="zen-tabs" role="tablist">
        {b.tabs.map((t) => {
          const pinned = !!b.bookmarked(t.url)?.pinned;
          return (
            <div
              key={t.key}
              className={`zen-tab ${t.key === b.activeKey ? 'is-active' : ''} ${t.sleeping ? 'is-sleeping' : ''}`}
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
                {t.loading ? <span className="browser-spinner" aria-hidden="true" /> : <Badge url={t.start ? t.url : ''} />}
                <span className="zen-tab-title">{t.title || 'New tab'}</span>
              </button>
              {t.start && !pinned && (
                <button className="zen-tab-act" onClick={() => void b.setPinned(t.url, t.title, true)} aria-label="Pin this site" title="Pin to the top">
                  <Icon name="thumbtack" size={11} />
                </button>
              )}
              <button className="zen-tab-act" onClick={() => b.closeTab(t.key)} aria-label="Close tab" title="Close tab (Ctrl+W)">
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

/** "Save your password?" after signing in somewhere. */
function PasswordBar() {
  const [prompt, setPrompt] = useState<PasswordPrompt | null>(null);
  useEffect(() => window.hub.onBrowserPasswordPrompt?.(setPrompt), []);
  if (!prompt) return null;
  const answer = (a: 'save' | 'never' | 'no') => {
    void window.hub.browserPasswordAnswer(prompt.id, a);
    setPrompt(null);
  };
  return (
    <div className="password-bar" role="dialog" aria-label="Save password">
      <span className="password-bar-key" aria-hidden="true">
        🔑
      </span>
      <span className="password-bar-text">
        Save your password for <b>{prompt.site}</b>
        {prompt.username && <span className="muted"> ({prompt.username})</span>}? It's kept encrypted on this computer.
      </span>
      <button className="button button-primary" onClick={() => answer('save')}>
        Save
      </button>
      <button className="button" onClick={() => answer('no')}>
        Not now
      </button>
      <button className="link-button" onClick={() => answer('never')}>
        Never for this site
      </button>
    </div>
  );
}

/** A new tab: search, favourite sites, your bookmarks, and importing Chrome's. */
function StartPage({ b, visible }: { b: Browser; visible: boolean }) {
  const [typed, setTyped] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const saved = b.bookmarks.filter((x) => !x.pinned);
  return (
    <div className="browser-start">
      <Spark size={34} />
      <h2>Where to?</h2>
      <AddressBox
        className="browser-start-search"
        value={typed}
        onType={(t) => setTyped(t ?? '')}
        onGo={(t) => b.go(t)}
        placeholder="Search Google or type an address"
        icon={<Icon name="search" size={16} />}
        autoFocus={visible}
      />
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
      {saved.length > 0 && (
        <div className="browser-bookmarks">
          <p className="browser-bookmarks-head">Bookmarks</p>
          <div className="browser-bookmarks-list">
            {saved.slice(0, 24).map((x) => (
              <span key={x.url} className="browser-bookmark">
                <button onClick={() => b.go(x.url)} title={x.url}>
                  <Badge url={x.url} />
                  <span>{x.title || shortAddress(x.url)}</span>
                </button>
                <button className="browser-bookmark-x" onClick={() => void b.removeBookmark(x.url)} aria-label="Remove bookmark" title="Remove">
                  <Icon name="x" size={10} />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="browser-start-actions">
        <button
          className="link-button"
          onClick={() =>
            void b
              .importBookmarks()
              .then((n) => setNote(n ? `Added ${n} bookmark${n === 1 ? '' : 's'} from Chrome or Edge.` : 'You already have all your Chrome and Edge bookmarks.'))
              .catch((err: unknown) => setNote(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err)))
          }
        >
          Import bookmarks from Chrome
        </button>
        <span aria-hidden="true">·</span>
        <button className="link-button" onClick={() => void window.hub.browserClearHistory().then(() => setNote('History cleared.'))}>
          Clear history
        </button>
      </div>
      {note && <p className="browser-start-note">{note}</p>}
      <p className="browser-start-tip">
        Highlight text on any page for <b>Ask AI</b>, or ask the AI to read the page, open sites, and click or fill things in for you.
      </p>
    </div>
  );
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

  return <webview ref={ref as never} className="browser-view" src={tab.start} partition="persist:browser" allowpopups={'true' as unknown as boolean} />;
}

/** The page itself, floating in the middle as a rounded card. */
export function BrowserView({ b, visible, onAskAboutPage }: { b: Browser; visible: boolean; onAskAboutPage: () => void }) {
  const { active } = b;
  const starred = !!active.start && !!b.bookmarked(active.url);
  return (
    <section className={`browser ${visible ? '' : 'is-hidden'}`} aria-hidden={!visible}>
      <header className="browser-top">
        <span className="browser-top-title" title={active.url}>
          {active.start ? active.title : 'New tab'}
        </span>
        <button
          className={`zen-btn browser-star ${starred ? 'is-on' : ''}`}
          disabled={!active.start}
          onClick={() => void b.toggleStar(active.url, active.title)}
          aria-label={starred ? 'Remove bookmark' : 'Bookmark this page'}
          title={starred ? 'Remove bookmark' : 'Bookmark this page'}
        >
          <Icon name="star" size={15} />
        </button>
        <button className="browser-ask" disabled={!active.start} onClick={onAskAboutPage} title="Ask Life Hub AI about this page">
          <Spark size={14} />
          Ask AI about this page
        </button>
        <button className="zen-btn" disabled={!active.start} onClick={() => window.open(active.url, '_blank')} aria-label="Open in your browser" title="Open in your usual browser">
          <Icon name="external" size={14} />
        </button>
      </header>
      <PasswordBar />
      <div className="browser-card" ref={b.views}>
        {b.tabs.map((t) =>
          t.start && !t.sleeping ? (
            <div key={t.key} data-tab={t.key} className={`browser-frame ${t.key === b.activeKey ? 'is-active' : ''}`}>
              <TabView tab={t} onChange={(p) => b.patch(t.key, p)} />
            </div>
          ) : (
            t.key === b.activeKey && !t.start && <StartPage key={t.key} b={b} visible={visible} />
          ),
        )}
      </div>
    </section>
  );
}
