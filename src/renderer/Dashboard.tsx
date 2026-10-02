import { useState } from 'react';
import { BriefingCard } from './components/BriefingCard';
import { CalendarCard } from './components/CalendarCard';
import { EmailCard } from './components/EmailCard';
import { NowCard } from './components/NowCard';
import { TasksCard } from './components/TasksCard';
import { WeatherCard } from './components/WeatherCard';
import { prettyShortcut, useNow, useSnapshot } from './hooks';

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
  const date = new Date(now);
  const usingSample = snapshot?.sources.some((s) => s.kind === 'sample');
  const failed = snapshot?.sources.filter((s) => !s.ok) ?? [];

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
          {usingSample && <span className="badge">Sample data</span>}
          <span className="muted small">
            Quick capture <kbd>{prettyShortcut(window.hub.captureShortcut, window.hub.platform)}</kbd>
          </span>
          <button className="button" onClick={refresh} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {failed.length > 0 && (
        <div className="alert">
          Couldn't load {failed.map((s) => s.name).join(', ')}. The rest of the dashboard is up to date.
        </div>
      )}

      {!snapshot ? (
        <div className="loading">Loading your day…</div>
      ) : (
        <main className="grid">
          <NowCard snapshot={snapshot} now={now} />
          <WeatherCard weather={snapshot.weather} commute={snapshot.commute} now={now} />
          <BriefingCard snapshot={snapshot} now={now} />
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
    </div>
  );
}
