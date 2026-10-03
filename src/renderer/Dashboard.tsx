import { useCallback, useEffect, useState } from 'react';
import type { SettingsView } from '../shared/types';
import { BriefingCard } from './components/BriefingCard';
import { DayView } from './components/DayView';
import { EmailCard } from './components/EmailCard';
import { Icon } from './components/Icon';
import { NextRow } from './components/NextRow';
import { FOCUS_MINUTES, NowCard } from './components/NowCard';
import { TasksCard } from './components/TasksCard';
import { TodayStrip } from './components/TodayStrip';
import { nowFocus } from '../shared/focus';
import { prettyShortcut, useFocus, useNow, useSnapshot } from './hooks';
import { SettingsErrorBoundary, SettingsPanel } from './SettingsPanel';
import { WrapUpPanel } from './WrapUpPanel';

/** "11:53" without the AM/PM, which is drawn smaller next to it. */
function clockParts(date: Date): { time: string; period: string } {
  const text = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const match = text.match(/^(.*?)\s*([AaPp]\.?\s?[Mm]\.?)$/);
  return match ? { time: match[1], period: match[2] } : { time: text, period: '' };
}

/** True while typing in a text box, so single-key shortcuts don't fire. */
function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

export function Dashboard() {
  const snapshot = useSnapshot();
  const now = useNow();
  const focusSession = useFocus();
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [wrapUpOpen, setWrapUpOpen] = useState(false);
  const [dayOpen, setDayOpen] = useState(false);
  const closeWrapUp = useCallback(() => setWrapUpOpen(false), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const closeDay = useCallback(() => setDayOpen(false), []);
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const date = new Date(now);
  const clock = clockParts(date);
  const usingSample = snapshot?.sources.some((s) => s.kind === 'sample');
  const failed = snapshot?.sources.filter((s) => !s.ok) ?? [];
  const weather = snapshot?.weather;

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

  // D opens and closes the day view; F starts or stops a focus session.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || settingsOpen || wrapUpOpen) return;
      const key = e.key.toLowerCase();
      if (key === 'd') setDayOpen((open) => !open);
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

  return (
    <div className={`app platform-${window.hub.platform}`}>
      <div className="backdrop" style={backgroundUrl ? { backgroundImage: `url("${backgroundUrl}")` } : undefined} aria-hidden="true" />
      <div className="frame">
        <div className="main">
          <header className="head">
            <div>
              <p className="label">{date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</p>
              <p className="clock">
                {clock.time}
                <span className="clock-period">{clock.period}</span>
              </p>
            </div>
            <div className="head-side">
              <div className="head-actions">
                {usingSample && (
                  <button className="label-button is-warning" onClick={() => setSettingsOpen(true)} title="Connect your accounts in Settings">
                    Sample data
                  </button>
                )}
                <button className="label-button is-lit" onClick={() => setDayOpen(true)}>
                  Day view <kbd>D</kbd>
                </button>
                <button className={`icon-button ${refreshing ? 'spinning' : ''}`} onClick={refresh} disabled={refreshing} title="Refresh" aria-label="Refresh">
                  <Icon name="refresh" size={15} />
                </button>
                <button className="icon-button" onClick={() => setSettingsOpen(true)} title="Settings" aria-label="Settings">
                  <Icon name="settings" size={15} />
                </button>
              </div>
              {weather && (
                <p className="head-weather">
                  {weather.location} {weather.temperatureF}° {weather.condition} · H{weather.highF} L{weather.lowF} · Rain {weather.precipitationChance}%
                </p>
              )}
            </div>
          </header>

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

          {!snapshot ? (
            <div className="loading">Loading your day_</div>
          ) : (
            <>
              <NowCard snapshot={snapshot} now={now} focusSession={focusSession} />
              <NextRow snapshot={snapshot} now={now} />
              <TodayStrip events={snapshot.events} now={now} onOpenDay={() => setDayOpen(true)} />
            </>
          )}
        </div>

        {snapshot && (
          <aside className="side">
            <EmailCard emails={snapshot.emails} />
            <TasksCard tasks={snapshot.tasks} notes={snapshot.notes} />
            <BriefingCard snapshot={snapshot} now={now} onWrapUp={() => setWrapUpOpen(true)} onOpenSettings={() => setSettingsOpen(true)} />
          </aside>
        )}
      </div>

      {snapshot && (
        <footer className="foot">
          <span>Updated {new Date(snapshot.generatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
          <span>
            Quick capture <kbd>{prettyShortcut(window.hub.captureShortcut, window.hub.platform)}</kbd>
          </span>
        </footer>
      )}

      {dayOpen && snapshot && <DayView events={snapshot.events} now={now} onClose={closeDay} />}
      {settingsOpen && (
        <SettingsErrorBoundary onClose={closeSettings}>
          <SettingsPanel onClose={closeSettings} onChange={setSettings} />
        </SettingsErrorBoundary>
      )}
      {wrapUpOpen && snapshot && <WrapUpPanel existing={snapshot.wrapUp} onClose={closeWrapUp} />}
    </div>
  );
}
