import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isSameDay } from '../shared/time';
import type { ChatTurn, SettingsView } from '../shared/types';
import { Icon, type IconName } from './components/Icon';
import { openLockedIn } from './components/LockedInCard';
import { TasksCard } from './components/TasksCard';
import type { WidgetContext } from './components/widgets';
import { prettyShortcut, useNow, useSnapshot } from './hooks';
import { CalendarPage } from './pages/CalendarPage';
import { ChatPage, Spark } from './pages/ChatPage';
import { BrowserTabs, BrowserView, useBrowser } from './pages/BrowserPage';
import { InboxPage } from './pages/InboxPage';
import { TodayPage } from './pages/TodayPage';
import { NowPlayingCard } from './components/NowPlayingCard';
import { SearchBar, type SearchActions } from './components/SearchBar';
import { usePlayer } from './player';
import { SettingsErrorBoundary, SettingsPanel } from './SettingsPanel';
import { Setup } from './Setup';
import { CrashScreen } from './CrashScreen';
import { WrapUpPanel } from './WrapUpPanel';

type Page = 'today' | 'calendar' | 'inbox' | 'tasks' | 'browser';

const PAGES: { id: Page; label: string; icon: IconName }[] = [
  { id: 'today', label: 'Dashboard', icon: 'grid' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar' },
  { id: 'inbox', label: 'Inbox', icon: 'mail' },
  { id: 'tasks', label: 'Tasks', icon: 'tasks' },
];

const AI_OPEN = 'life-hub-ai-open';

/** The AI panel on the right stays open or closed between visits. */
function useAiOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(AI_OPEN) !== 'false';
    } catch {
      return true;
    }
  });
  const set = (next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(AI_OPEN, String(next));
    } catch {
      // Not remembered; fine.
    }
  };
  return [open, set];
}

function greeting(hour: number): string {
  if (hour < 5) return 'Up late';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** True while typing in a text box, so single-key shortcuts don't fire. */
function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

const CHAT_KEY = 'lifehub.chat';

function loadChat(): ChatTurn[] {
  try {
    const saved = JSON.parse(localStorage.getItem(CHAT_KEY) ?? '[]') as unknown;
    return Array.isArray(saved) ? (saved as ChatTurn[]).filter((t) => (t?.role === 'user' || t?.role === 'assistant') && typeof t.content === 'string') : [];
  } catch {
    return [];
  }
}

/** The last 60 messages, without pictures (they're too big to keep). */
function saveChat(chat: ChatTurn[]): void {
  try {
    localStorage.setItem(CHAT_KEY, JSON.stringify(chat.slice(-60).map(({ images: _images, ...t }) => t)));
  } catch {
    // Storage full or blocked: the chat still works, it just won't be kept.
  }
}

export function Dashboard() {
  const snapshot = useSnapshot();
  const now = useNow();
  const player = usePlayer();
  const [page, setPage] = useState<Page>('today');
  // While browsing, the menu's place shows your tabs (like Zen); this flips back to the menu.
  const [showMenu, setShowMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  // A highlight that glides to the page you pick in the menu.
  const navRef = useRef<HTMLElement>(null);
  const [glide, setGlide] = useState({ top: 0, height: 0, on: false });
  useLayoutEffect(() => {
    const on = navRef.current?.querySelector<HTMLElement>('button.is-on');
    setGlide((g) => (on ? { top: on.offsetTop, height: on.offsetHeight, on: true } : { ...g, on: false }));
  }, [page, showMenu]);
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [wrapUpOpen, setWrapUpOpen] = useState(false);
  const closeWrapUp = useCallback(() => setWrapUpOpen(false), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const [settings, setSettings] = useState<SettingsView | null>(null);
  // Bumped when first-run setup ends, so the dashboard loads the layout picked there.
  const [setupRound, setSetupRound] = useState(0);
  // Kept here so the conversation survives switching pages.
  // The conversation is kept on this computer, so it's still there after a restart (New chat clears it).
  const [chat, setChat] = useState<ChatTurn[]>(loadChat);
  useEffect(() => saveChat(chat), [chat]);
  const [ask, setAsk] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useAiOpen();
  // The AI is always beside the dashboard and the other pages, so widgets never shift.
  // Only the Browser can hide it, for more room; leaving the Browser slides it back.
  const aiShown = page !== 'browser' || aiOpen;
  // Highlighted text from the browser, waiting for a question about it.
  const [quote, setQuote] = useState<{ text: string; title: string } | null>(null);
  // The browser stays loaded once opened, so its tabs survive switching pages.
  const [browserOn, setBrowserOn] = useState(false);
  const [browserOpen, setBrowserOpen] = useState<{ url: string; n: number } | null>(null);
  const browser = useBrowser({ visible: page === 'browser', open: browserOpen });
  const openBrowser = () => {
    setBrowserOn(true);
    setPage('browser');
    setEditing(false);
    setShowMenu(false);
  };
  useEffect(() => {
    if (!window.hub.onBrowserNewTab) return;
    const stopTabs = window.hub.onBrowserNewTab((url) => {
      setBrowserOn(true);
      setBrowserOpen({ url, n: Date.now() + Math.random() });
      setPage('browser');
    });
    const stopAsk = window.hub.onBrowserAsk((a) => {
      setAiOpen(true);
      if (a.kind === 'explain') setAsk(`> ${a.text.trim().replace(/\n+/g, '\n> ')}\n\nExplain this${a.title ? ` (from “${a.title}”)` : ''}.`);
      else setQuote({ text: a.text, title: a.title });
    });
    return () => {
      stopTabs();
      stopAsk();
    };
  }, []);
  const date = new Date(now);
  const usingSample = snapshot?.sources.some((s) => s.kind === 'sample');
  const failed = snapshot?.sources.filter((s) => !s.ok) ?? [];
  const weather = snapshot?.weather;
  const email = settings?.google.email;
  const aiOn = Boolean(settings?.ai && 'provider' in settings.ai && settings.ai.provider !== 'off');

  const counts: Partial<Record<Page, number>> = snapshot
    ? {
        calendar: snapshot.events.filter((e) => isSameDay(e.start, date) && new Date(e.end).getTime() > now).length,
        inbox: snapshot.emails.filter((e) => e.needsReply).length,
        tasks: snapshot.tasks.filter((t) => !t.done).length,
      }
    : {};

  // Re-read settings with each snapshot, so a Google sign-in that expired shows up here.
  useEffect(() => {
    void window.hub.getSettings().then(setSettings);
  }, [snapshot, settingsOpen]);

  // The theme lives on the page root so every colour follows it.
  const theme = settings?.theme ?? 'purple';
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Load the user's own background picture whenever it changes in Settings.
  const backgroundVersion = settings?.background?.version ?? 0;
  useEffect(() => {
    if (!backgroundVersion || !window.hub.getBackground) {
      setBackgroundUrl(null);
      return;
    }
    let alive = true;
    void window.hub.getBackground().then((url) => alive && setBackgroundUrl(url));
    return () => {
      alive = false;
    };
  }, [backgroundVersion]);

  // D opens the calendar; F opens LockedIn, the focus timer site.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || settingsOpen || wrapUpOpen) return;
      const key = e.key.toLowerCase();
      if (key === 'd') setPage((p) => (p === 'calendar' ? 'today' : 'calendar'));
      if (key === 'f') openLockedIn();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settingsOpen, wrapUpOpen]);

  async function refresh() {
    setRefreshing(true);
    try {
      await window.hub.refresh();
    } finally {
      setRefreshing(false);
    }
  }

  const searchActions: SearchActions = {
    go: (p) => {
      if (p === 'chat') return setAiOpen(true);
      setPage(p);
      setEditing(false);
    },
    openSettings: () => setSettingsOpen(true),
    customize: () => {
      setPage('today');
      setEditing(true);
    },
    wrapUp: () => setWrapUpOpen(true),
    refresh: () => void refresh(),
    ask: (question) => {
      setAiOpen(true);
      setAsk(question);
    },
  };

  const ctx: WidgetContext | null = snapshot
    ? {
        snapshot,
        now,
        onWrapUp: () => setWrapUpOpen(true),
        onOpenSettings: () => setSettingsOpen(true),
        onOpenCalendar: () => setPage('calendar'),
        onOpenLink: (url: string) => {
          setBrowserOn(true);
          setBrowserOpen({ url, n: Date.now() + Math.random() });
          setPage('browser');
        },
        player,
      }
    : null;

  const titles: Record<Page, string> = {
    today: greeting(date.getHours()),
    calendar: 'Calendar',
    inbox: 'Inbox',
    tasks: 'Tasks',
    browser: 'Browser',
  };

  return (
    <div className={`app platform-${window.hub.platform} ${aiShown ? 'has-ai' : 'no-ai'}`}>
      <div className="backdrop" style={backgroundUrl ? { backgroundImage: `url("${backgroundUrl}")` } : undefined} aria-hidden="true" />

      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">◆</span>
          Life Hub
        </div>
        {/* The dashboard is the main page, so it gets its own big button. */}
        <button
          className={`nav-home ${page === 'today' ? 'is-on' : ''}`}
          onClick={() => {
            setPage('today');
            setEditing(false);
          }}
        >
          <span className="nav-home-icon">
            <Icon name="grid" size={17} />
          </span>
          <span className="nav-home-text">
            Dashboard
            <span>Your day at a glance</span>
          </span>
        </button>
        <button className={`nav-home nav-browser ${page === 'browser' ? 'is-on' : ''}`} onClick={openBrowser}>
          <span className="nav-home-icon">
            <Icon name="globe" size={17} />
          </span>
          <span className="nav-home-text">
            Browser
            <span>{browserOn && browser.tabs.some((t) => t.start) ? `${browser.tabs.length} tab${browser.tabs.length === 1 ? '' : 's'} open` : 'The web, with AI beside it'}</span>
          </span>
        </button>
        {page === 'browser' && (
          <div className="side-switch" role="tablist" aria-label="Show tabs or the menu">
            <button className={!showMenu ? 'is-on' : ''} onClick={() => setShowMenu(false)} role="tab" aria-selected={!showMenu}>
              Tabs
            </button>
            <button className={showMenu ? 'is-on' : ''} onClick={() => setShowMenu(true)} role="tab" aria-selected={showMenu}>
              Menu
            </button>
          </div>
        )}
        {page === 'browser' && !showMenu ? (
          <BrowserTabs b={browser} />
        ) : (
        <>
        <p className="nav-heading">Menu</p>
        <nav className="nav nav-main" ref={navRef}>
          <span
            className={`nav-glide ${glide.on ? 'is-on' : ''}`}
            style={{ transform: `translateY(${glide.top}px)`, height: glide.height }}
            aria-hidden="true"
          />
          {PAGES.filter((p) => p.id !== 'today').map((p) => (
            <button
              key={p.id}
              className={page === p.id ? 'is-on' : ''}
              onClick={() => {
                setPage(p.id);
                setEditing(false);
              }}
            >
              <Icon name={p.icon} size={16} />
              {p.label}
              {counts[p.id] !== undefined && <span className="nav-count">{counts[p.id]}</span>}
            </button>
          ))}
          <button onClick={openLockedIn} title="Open LockedIn in your browser (F)">
            <Icon name="timer" size={16} />
            LockedIn
            <Icon name="external" size={13} className="nav-external" />
          </button>
        </nav>
        </>
        )}
        <NowPlayingCard player={player} />
        <nav className="nav nav-bottom">
          <button onClick={() => setSettingsOpen(true)}>
            <Icon name="settings" size={16} />
            Settings
          </button>
        </nav>
      </aside>

      <main className={`main ${page === 'browser' ? 'is-browser' : ''}`}>
        {browserOn && (
          <BrowserView
            b={browser}
            visible={page === 'browser'}
            onAskAboutPage={() => {
              setAiOpen(true);
              setAsk('Summarize this page for me.');
            }}
          />
        )}
        {page !== 'browser' && (
        <>
        <header className="topbar">
          {usingSample && (
            <button className="badge" onClick={() => setSettingsOpen(true)} title="Connect your accounts in Settings">
              Sample data
            </button>
          )}
          {snapshot && <SearchBar snapshot={snapshot} player={player} now={now} actions={searchActions} />}
          <span className="topbar-right">
            {weather && (
              <span className="muted">
                {weather.location} · {weather.temperatureF}° {weather.condition.toLowerCase()}
              </span>
            )}
            <span className="avatar avatar-me" title={email ?? 'Not signed in'}>
              {(email?.[0] ?? '·').toUpperCase()}
            </span>
          </span>
        </header>

        <div className="page-head">
          <div>
            <h1>{titles[page]}</h1>
            <p className="muted">
              {date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })} ·{' '}
              {date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            </p>
          </div>
          <div className="page-actions">
            <button className={`icon-button ${refreshing ? 'spinning' : ''}`} onClick={refresh} disabled={refreshing} title="Refresh" aria-label="Refresh">
              <Icon name="refresh" size={15} />
            </button>
            {page === 'today' && !editing && (
              <button className="button" onClick={() => setEditing(true)}>
                <Icon name="sliders" size={14} /> Customize
              </button>
            )}
          </div>
        </div>

        {settings && !settings.google.connected && (
          <div className={`alert ${settings.google.error ? '' : 'alert-info'}`}>
            <span className="alert-text">{settings.google.error ?? 'Connect your Google account to see your real calendar and email.'}</span>
            <button className="link-button" onClick={() => setSettingsOpen(true)}>
              Open Settings
            </button>
          </div>
        )}

        {settings?.google.connected && settings.google.canSaveDrafts && (settings.google.canAddEvents === false || settings.google.canChangeMail === false) && (
          <div className="alert alert-info">
            <span className="alert-text">
              Life Hub can now add to your calendar and archive, delete and star email. Sign out of Google in Settings and sign in again to allow it.
            </span>
            <button className="link-button" onClick={() => setSettingsOpen(true)}>
              Open Settings
            </button>
          </div>
        )}

        {settings?.google.connected && !settings.google.canSaveDrafts && (
          <div className="alert alert-info">
            <span className="alert-text">Life Hub can now save draft replies in Gmail. Sign in to Google again to allow it.</span>
            <button className="link-button" onClick={() => setSettingsOpen(true)}>
              Open Settings
            </button>
          </div>
        )}

        {failed.length > 0 && (
          <div className="alert">
            <div className="alert-text">
              {failed.map((s) => (
                <div key={s.name}>
                  Couldn't load {s.name}
                  {s.error ? `: ${s.error}` : '.'}
                </div>
              ))}
              <div className="muted">The rest of the dashboard is up to date.</div>
            </div>
          </div>
        )}

        {/* Each page slides in when you switch to it. */}
        <div className="page-in" key={page}>
          <CrashScreen where={page}>
            {!snapshot || !ctx ? (
              <div className="loading">Loading your day…</div>
            ) : page === 'today' ? (
              <TodayPage key={setupRound} ctx={ctx} editing={editing} onDoneEditing={() => setEditing(false)} />
            ) : page === 'calendar' ? (
              <CalendarPage events={snapshot.events} tasks={snapshot.tasks} plans={snapshot.plans ?? []} now={now} version={snapshot.generatedAt} />
            ) : page === 'inbox' ? (
              <InboxPage emails={snapshot.emails} aiOn={aiOn} onOpenSettings={() => setSettingsOpen(true)} />
            ) : (
              <TasksCard tasks={snapshot.tasks} notes={snapshot.notes} />
            )}
          </CrashScreen>
        </div>

        {snapshot && (
          <footer className="foot muted">
            <span>Updated {new Date(snapshot.generatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
            <span>
              Quick capture <kbd>{prettyShortcut(window.hub.captureShortcut, window.hub.platform)}</kbd>
            </span>
          </footer>
        )}
        </>
        )}
      </main>

      {/* The AI, always on the right: ask about your day, or tell it to do things. */}
      {aiShown ? (
        <aside className="ai-panel" aria-label="Life Hub AI">
          <header className="ai-head">
            <span className="ai-title">
              <Spark size={16} />
              <span className="ai-title-text">{chat.length > 0 ? chat[0].content : 'Life Hub AI'}</span>
            </span>
            {chat.length > 0 && (
              <button className="icon-button ai-clear" onClick={() => setChat([])} title="New chat" aria-label="New chat">
                <Icon name="new-chat" size={14} />
              </button>
            )}
            {page === 'browser' && (
              <button className="icon-button ai-hide" onClick={() => setAiOpen(false)} title="Hide the AI panel" aria-label="Hide the AI panel">
                <Icon name="next" size={14} />
              </button>
            )}
          </header>
          <ChatPage
            aiOn={aiOn}
            messages={chat}
            onMessages={setChat}
            onOpenSettings={() => setSettingsOpen(true)}
            ask={ask}
            onAsked={() => setAsk(null)}
            quote={quote}
            onQuoteUsed={() => setQuote(null)}
            panel
          />
        </aside>
      ) : (
        <button className="ai-tab" onClick={() => setAiOpen(true)} title="Open Life Hub AI" aria-label="Open Life Hub AI">
          <Spark size={16} />
          <span>AI</span>
        </button>
      )}

      {settingsOpen && (
        <SettingsErrorBoundary onClose={closeSettings}>
          <SettingsPanel onClose={closeSettings} onChange={setSettings} />
        </SettingsErrorBoundary>
      )}
      {wrapUpOpen && snapshot && <WrapUpPanel existing={snapshot.wrapUp} onClose={closeWrapUp} />}
      {settings?.profile && !settings.profile.setupDone && <Setup view={settings} onChange={setSettings} onDone={() => setSetupRound((n) => n + 1)} />}
    </div>
  );
}
