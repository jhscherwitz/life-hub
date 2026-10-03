import { useCallback, useEffect, useState } from 'react';
import { nowFocus } from '../shared/focus';
import { isSameDay } from '../shared/time';
import type { SettingsView } from '../shared/types';
import { EmailCard } from './components/EmailCard';
import { Icon, type IconName } from './components/Icon';
import { FOCUS_MINUTES } from './components/NowCard';
import { TasksCard } from './components/TasksCard';
import type { WidgetContext } from './components/widgets';
import { prettyShortcut, useFocus, useNow, useSnapshot } from './hooks';
import { CalendarPage } from './pages/CalendarPage';
import { FocusPage } from './pages/FocusPage';
import { TodayPage } from './pages/TodayPage';
import { SettingsErrorBoundary, SettingsPanel } from './SettingsPanel';
import { WrapUpPanel } from './WrapUpPanel';

type Page = 'today' | 'calendar' | 'inbox' | 'tasks' | 'focus';

const PAGES: { id: Page; label: string; icon: IconName }[] = [
  { id: 'today', label: 'Today', icon: 'grid' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar' },
  { id: 'inbox', label: 'Inbox', icon: 'mail' },
  { id: 'tasks', label: 'Tasks', icon: 'tasks' },
  { id: 'focus', label: 'Focus', icon: 'timer' },
];

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

export function Dashboard() {
  const snapshot = useSnapshot();
  const now = useNow();
  const focusSession = useFocus();
  const [page, setPage] = useState<Page>('today');
  const [editing, setEditing] = useState(false);
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [wrapUpOpen, setWrapUpOpen] = useState(false);
  const closeWrapUp = useCallback(() => setWrapUpOpen(false), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const date = new Date(now);
  const usingSample = snapshot?.sources.some((s) => s.kind === 'sample');
  const failed = snapshot?.sources.filter((s) => !s.ok) ?? [];
  const weather = snapshot?.weather;
  const email = settings?.google.email;

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

  // D opens the calendar; F starts or stops a focus session.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || settingsOpen || wrapUpOpen) return;
      const key = e.key.toLowerCase();
      if (key === 'd') setPage((p) => (p === 'calendar' ? 'today' : 'calendar'));
      if (key === 'f' && window.hub.startFocus && snapshot) {
        if (focusSession) void window.hub.stopFocus();
        else void window.hub.startFocus(FOCUS_MINUTES, nowFocus(snapshot, Date.now()).headline);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settingsOpen, wrapUpOpen, snapshot, focusSession]);

  async function refresh() {
    setRefreshing(true);
    try {
      await window.hub.refresh();
    } finally {
      setRefreshing(false);
    }
  }

  const ctx: WidgetContext | null = snapshot
    ? {
        snapshot,
        now,
        focusSession,
        onWrapUp: () => setWrapUpOpen(true),
        onOpenSettings: () => setSettingsOpen(true),
        onOpenCalendar: () => setPage('calendar'),
      }
    : null;

  const titles: Record<Page, string> = {
    today: greeting(date.getHours()),
    calendar: 'Calendar',
    inbox: 'Inbox',
    tasks: 'Tasks',
    focus: 'Focus',
  };

  return (
    <div className={`app platform-${window.hub.platform}`}>
      <div className="backdrop" style={backgroundUrl ? { backgroundImage: `url("${backgroundUrl}")` } : undefined} aria-hidden="true" />

      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">◆</span>
          Life Hub
        </div>
        <p className="nav-heading">Menu</p>
        <nav className="nav">
          {PAGES.map((p) => (
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
        </nav>
        <nav className="nav nav-bottom">
          <button onClick={() => setSettingsOpen(true)}>
            <Icon name="settings" size={16} />
            Settings
          </button>
        </nav>
      </aside>

      <main className="main">
        <header className="topbar">
          {usingSample && (
            <button className="badge" onClick={() => setSettingsOpen(true)} title="Connect your accounts in Settings">
              Sample data
            </button>
          )}
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
            {window.hub.startFocus && !focusSession && snapshot && (
              <button className="button button-primary" onClick={() => void window.hub.startFocus(FOCUS_MINUTES, nowFocus(snapshot, now).headline)}>
                <Icon name="timer" size={14} /> Focus {FOCUS_MINUTES} min
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

        {!snapshot || !ctx ? (
          <div className="loading">Loading your day…</div>
        ) : page === 'today' ? (
          <TodayPage ctx={ctx} editing={editing} onDoneEditing={() => setEditing(false)} />
        ) : page === 'calendar' ? (
          <CalendarPage events={snapshot.events} now={now} />
        ) : page === 'inbox' ? (
          <EmailCard emails={snapshot.emails} />
        ) : page === 'tasks' ? (
          <TasksCard tasks={snapshot.tasks} notes={snapshot.notes} />
        ) : (
          <FocusPage snapshot={snapshot} now={now} focusSession={focusSession} />
        )}

        {snapshot && (
          <footer className="foot muted">
            <span>Updated {new Date(snapshot.generatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
            <span>
              Quick capture <kbd>{prettyShortcut(window.hub.captureShortcut, window.hub.platform)}</kbd>
            </span>
          </footer>
        )}
      </main>

      {settingsOpen && (
        <SettingsErrorBoundary onClose={closeSettings}>
          <SettingsPanel onClose={closeSettings} onChange={setSettings} />
        </SettingsErrorBoundary>
      )}
      {wrapUpOpen && snapshot && <WrapUpPanel existing={snapshot.wrapUp} onClose={closeWrapUp} />}
    </div>
  );
}
