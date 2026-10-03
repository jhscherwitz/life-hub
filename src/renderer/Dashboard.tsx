import { useCallback, useEffect, useState } from 'react';
import type { SettingsView } from '../shared/types';
import { BriefingCard } from './components/BriefingCard';
import { CalendarCard } from './components/CalendarCard';
import { EmailCard } from './components/EmailCard';
import { NowCard } from './components/NowCard';
import { TasksCard } from './components/TasksCard';
import { Icon } from './components/Icon';
import { StatsStrip } from './components/StatsStrip';
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

/** "11:18" and "PM" separately, so the period can be drawn smaller. */
function clockParts(date: Date): { time: string; period: string } {
  const text = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const match = text.match(/^(.*?)\s*([AaPp]\.?\s?[Mm]\.?)$/);
  return match ? { time: match[1], period: match[2] } : { time: text, period: '' };
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
  const clock = clockParts(date);
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
        <div className="topbar-title">
          <p className="clock">
            {clock.time}
            <span className="clock-period">{clock.period}</span>
          </p>
          <div>
            <h1>
              {greeting(date.getHours())}, <span className="name">Jacob</span>
            </h1>
            <p className="topbar-date">
              {date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
          </div>
        </div>
        <div className="topbar-actions">
          {usingSample && (
            <button className="badge badge-button" onClick={() => setSettingsOpen(true)} title="Connect your accounts in Settings">
              <span className="badge-dot" />
              Sample data
            </button>
          )}
          <span className="capture-hint-top">
            <Icon name="bolt" size={13} />
            Quick capture <kbd>{prettyShortcut(window.hub.captureShortcut, window.hub.platform)}</kbd>
          </span>
          <div className="toolbar">
            <button className={`icon-button ${refreshing ? 'spinning' : ''}`} onClick={refresh} disabled={refreshing} title="Refresh" aria-label="Refresh">
              <Icon name="refresh" size={16} />
            </button>
            <button className="icon-button" onClick={() => setSettingsOpen(true)} title="Settings" aria-label="Settings">
              <Icon name="settings" size={16} />
            </button>
          </div>
        </div>
      </header>

      {settings && !settings.google.connected && (
        <div className={`alert ${settings.google.error ? '' : 'alert-info'}`}>
          <Icon name={settings.google.error ? 'alert' : 'info'} size={16} />
          <span className="alert-text">{settings.google.error ?? 'Connect your Google account to see your real calendar and email.'}</span>
          <button className="link-button" onClick={() => setSettingsOpen(true)}>
            Open Settings
          </button>
        </div>
      )}

      {settings?.google.connected && !settings.google.canSaveDrafts && (
        <div className="alert alert-info">
          <Icon name="info" size={16} />
          <span className="alert-text">Life Hub can now save draft replies in Gmail. Sign in to Google again to allow it.</span>
          <button className="link-button" onClick={() => setSettingsOpen(true)}>
            Open Settings
          </button>
        </div>
      )}

      {failed.length > 0 && (
        <div className="alert">
          <Icon name="alert" size={16} />
          <div className="alert-text">
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
        <div className="loading">
          <span className="loading-dot" />
          Loading your day…
        </div>
      ) : (
        <main className="grid">
          <StatsStrip snapshot={snapshot} now={now} />
          <NowCard snapshot={snapshot} now={now} />
          <WeatherCard weather={snapshot.weather} commute={snapshot.commute} now={now} />
          <BriefingCard snapshot={snapshot} now={now} onWrapUp={() => setWrapUpOpen(true)} onOpenSettings={() => setSettingsOpen(true)} />
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
