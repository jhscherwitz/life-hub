import { useCallback, useEffect, useState } from 'react';
import type { SettingsView } from '../shared/types';
import { BriefingCard } from './components/BriefingCard';
import { CalendarCard } from './components/CalendarCard';
import { EmailCard } from './components/EmailCard';
import { NowCard } from './components/NowCard';
import { TasksCard } from './components/TasksCard';
import { WeatherCard } from './components/WeatherCard';
import { prettyShortcut, useNow, useSnapshot } from './hooks';
import { SettingsErrorBoundary, SettingsPanel } from './SettingsPanel';
import { WrapUpPanel } from './WrapUpPanel';

function greeting(hour: number): string {
  if (hour < 5) return 'Up late';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function Dashboard() {
  const snapshot = useSnapshot();
  const now = useNow();
  const [refreshing, setRefreshing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [wrapUpOpen, setWrapUpOpen] = useState(false);
  const closeWrapUp = useCallback(() => setWrapUpOpen(false), []);
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const date = new Date(now);
  const usingSample = snapshot?.sources.some((s) => s.kind === 'sample');
  const failed = snapshot?.sources.filter((s) => !s.ok) ?? [];
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  // Re-read settings with each snapshot, so a Google sign-in that expired shows up here.
  useEffect(() => {
    void window.hub.getSettings().then(setSettings);
  }, [snapshot, settingsOpen]);

  async function refresh() {
    setRefreshing(true);
    try {
      await window.hub.refresh();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className={`app platform-${window.hub.platform}`}>
      <header className="topbar">
        <div>
          <h1>{greeting(date.getHours())}, Jacob</h1>
          <p className="muted">
            {date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <div className="topbar-actions">
          {usingSample && (
            <button className="badge badge-button" onClick={() => setSettingsOpen(true)} title="Connect your accounts in Settings">
              Some sample data
            </button>
          )}
          <span className="muted small">
            Quick capture <kbd>{prettyShortcut(window.hub.captureShortcut, window.hub.platform)}</kbd>
          </span>
          <button className="button" onClick={refresh} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <button className="button" onClick={() => setSettingsOpen(true)}>
            Settings
          </button>
        </div>
      </header>

      {settings && !settings.google.connected && (
        <div className={`alert ${settings.google.error ? '' : 'alert-info'}`}>
          <span>{settings.google.error ?? 'Connect your Google account to see your real calendar and email.'}</span>
          <button className="link-button" onClick={() => setSettingsOpen(true)}>
            Open Settings
          </button>
        </div>
      )}

      {settings?.google.connected && !settings.google.canSaveDrafts && (
        <div className="alert alert-info">
          <span>Life Hub can now save draft replies in Gmail. Sign in to Google again to allow it.</span>
          <button className="link-button" onClick={() => setSettingsOpen(true)}>
            Open Settings
          </button>
        </div>
      )}

      {failed.length > 0 && (
        <div className="alert">
          <div>
            {failed.map((s) => (
              <div key={s.name}>
                Couldn't load {s.name}
                {s.error ? `: ${s.error}` : '.'}
              </div>
            ))}
            <div className="small">The rest of the dashboard is up to date.</div>
          </div>
        </div>
      )}

      {!snapshot ? (
        <div className="loading">Loading your day…</div>
      ) : (
        <main className="grid">
          <BriefingCard snapshot={snapshot} now={now} onWrapUp={() => setWrapUpOpen(true)} onOpenSettings={() => setSettingsOpen(true)} />
          <NowCard snapshot={snapshot} now={now} />
          <WeatherCard weather={snapshot.weather} commute={snapshot.commute} now={now} />
          <CalendarCard events={snapshot.events} now={now} />
          <EmailCard emails={snapshot.emails} />
          <TasksCard tasks={snapshot.tasks} notes={snapshot.notes} />
        </main>
      )}

      {snapshot && (
        <footer className="footer muted small">
          Updated {new Date(snapshot.generatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
        </footer>
      )}

      {settingsOpen && (
        <SettingsErrorBoundary onClose={closeSettings}>
          <SettingsPanel onClose={closeSettings} />
        </SettingsErrorBoundary>
      )}
      {wrapUpOpen && snapshot && <WrapUpPanel existing={snapshot.wrapUp} onClose={closeWrapUp} />}
    </div>
  );
}
