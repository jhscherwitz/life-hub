import { useEffect, useState, type FormEvent } from 'react';
import type { CommuteMode, Place, SettingsView } from '../shared/types';
import { errorText } from './hooks';

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

function GoogleSection({ view, onChange }: { view: SettingsView; onChange: (v: SettingsView) => void }) {
  const { google } = view;
  const [editing, setEditing] = useState(!google.hasCredentials);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const { busy, error, run } = useAction();

  const saveCredentials = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      onChange(await window.hub.saveGoogleCredentials({ clientId, clientSecret }));
      setEditing(false);
      setClientSecret('');
    });
  };

  return (
    <section className="settings-section">
      <h3>Google Calendar & Gmail</h3>
      {google.connected ? (
        <>
          <p>
            <span className="status-dot ok" /> Signed in as <strong>{google.email ?? 'your Google account'}</strong>
          </p>
          {google.canSaveDrafts ? (
            <p className="muted small">
              Hub can read your calendar and inbox, and save draft replies in Gmail. It never sends email: drafts wait in Gmail until you send them.
            </p>
          ) : (
            <p className="settings-warning small">
              To save draft replies in Gmail, Hub needs one more permission. Click <strong>Sign out</strong>, then <strong>Sign in with Google</strong>{' '}
              again and tick every box.
            </p>
          )}
          <div className="settings-actions">
            <button className="button" disabled={busy} onClick={() => void run(async () => onChange(await window.hub.googleSignOut()))}>
              Sign out
            </button>
          </div>
        </>
      ) : editing ? (
        <form onSubmit={saveCredentials} className="settings-form">
          <p className="muted small">
            Paste the Client ID and Client secret from Google Cloud. The README has step-by-step instructions for getting them.
          </p>
          <label>
            Client ID
            <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="1234-abc.apps.googleusercontent.com" spellCheck={false} />
          </label>
          <label>
            Client secret
            <input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="GOCSPX-…" spellCheck={false} />
          </label>
          <div className="settings-actions">
            <button className="button button-primary" type="submit" disabled={busy || !clientId || !clientSecret}>
              Save
            </button>
            {google.hasCredentials && (
              <button className="button" type="button" onClick={() => setEditing(false)}>
                Cancel
              </button>
            )}
          </div>
        </form>
      ) : (
        <>
          {google.error ? <p className="settings-error">{google.error}</p> : <p className="muted small">Not signed in. Showing sample calendar and email.</p>}
          <div className="settings-actions">
            <button className="button button-primary" disabled={busy} onClick={() => void run(async () => onChange(await window.hub.googleSignIn()))}>
              {busy ? 'Finish signing in in your browser…' : 'Sign in with Google'}
            </button>
            <button className="link-button" disabled={busy} onClick={() => setEditing(true)}>
              Change Client ID
            </button>
          </div>
        </>
      )}
      {error && <p className="settings-error">{error}</p>}
    </section>
  );
}

function WeatherSection({ view, onChange }: { view: SettingsView; onChange: (v: SettingsView) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[] | null>(null);
  const { busy, error, run } = useAction();
  const place = view.weather.place;

  const search = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => setResults(await window.hub.searchPlaces(query)));
  };
  const choose = (p: Place | null) =>
    void run(async () => {
      onChange(await window.hub.setWeatherPlace(p));
      setResults(null);
      setQuery('');
    });

  return (
    <section className="settings-section">
      <h3>Weather</h3>
      {place ? (
        <p>
          <span className="status-dot ok" /> Showing weather for <strong>{place.name}</strong>
          <span className="muted"> · {place.region}</span>{' '}
          <button className="link-button" onClick={() => choose(null)}>
            Remove
          </button>
        </p>
      ) : (
        <p className="muted small">Pick your town to see real weather. Until then the dashboard shows sample weather.</p>
      )}
      <form onSubmit={search} className="settings-inline">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search for a town or city" />
        <button className="button" type="submit" disabled={busy || query.trim().length < 2}>
          Search
        </button>
      </form>
      {results && (
        <ul className="list place-results">
          {results.length === 0 && <li className="muted small">No places found. Try just the town name.</li>}
          {results.map((r) => (
            <li key={`${r.latitude},${r.longitude}`}>
              <button className="place-option" onClick={() => choose(r)}>
                <strong>{r.name}</strong> <span className="muted">{r.region}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="settings-error">{error}</p>}
    </section>
  );
}

const MODES: { value: CommuteMode; label: string }[] = [
  { value: 'drive', label: 'Drive' },
  { value: 'bike', label: 'Bike' },
  { value: 'walk', label: 'Walk' },
];

function CommuteSection({ view, onChange }: { view: SettingsView; onChange: (v: SettingsView) => void }) {
  const [address, setAddress] = useState(view.commute.homeAddress);
  const [mode, setMode] = useState<CommuteMode>(view.commute.mode);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  const dirty = address.trim() !== view.commute.homeAddress || mode !== view.commute.mode;

  const save = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      onChange(await window.hub.setCommute({ homeAddress: address, mode }));
      setSaved(true);
    });
  };

  return (
    <section className="settings-section">
      <h3>Commute</h3>
      <p className="muted small">
        Hub works out how long it takes to get from home to your next meeting that has an address, and when to leave. Travel times come from
        OpenStreetMap and don't include live traffic, so Hub adds 10 minutes.
      </p>
      <form onSubmit={save} className="settings-form">
        <label>
          Home address
          <input
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
              setSaved(false);
            }}
            placeholder="123 Main St, Springfield"
          />
        </label>
        <div className="segmented">
          {MODES.map((m) => (
            <button
              type="button"
              key={m.value}
              className={mode === m.value ? 'active' : ''}
              onClick={() => {
                setMode(m.value);
                setSaved(false);
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="settings-actions">
          <button className="button button-primary" type="submit" disabled={busy || !dirty}>
            Save
          </button>
          {saved && !dirty && <span className="settings-saved small">Saved</span>}
        </div>
      </form>
      {error && <p className="settings-error">{error}</p>}
    </section>
  );
}

function ClaudeSection({ view, onChange }: { view: SettingsView; onChange: (v: SettingsView) => void }) {
  const [key, setKey] = useState('');
  const { busy, error, run } = useAction();

  const save = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      onChange(await window.hub.saveAnthropicKey(key));
      setKey('');
    });
  };

  return (
    <section className="settings-section">
      <h3>Claude (AI writing)</h3>
      <p className="muted small">
        With an Anthropic API key, Claude writes your morning briefing, picks out the emails that need a reply, drafts replies and sums up your
        evening wrap-up. Without one, Hub writes simpler versions itself. To do this, Hub sends your calendar, task titles and the emails it's
        working on to Anthropic. Usage is billed to your Anthropic account. The README explains how to get a key.
      </p>
      {view.ai.hasKey ? (
        <div className="settings-actions">
          <span>
            <span className="status-dot ok" /> Claude is on
          </span>
          <button className="link-button" disabled={busy} onClick={() => void run(async () => onChange(await window.hub.removeAnthropicKey()))}>
            Remove key
          </button>
        </div>
      ) : (
        <form onSubmit={save} className="settings-inline">
          <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" spellCheck={false} />
          <button className="button button-primary" type="submit" disabled={busy || !key.trim()}>
            {busy ? 'Checking…' : 'Save'}
          </button>
        </form>
      )}
      {error && <p className="settings-error">{error}</p>}
    </section>
  );
}

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<SettingsView | null>(null);

  useEffect(() => {
    void window.hub.getSettings().then(setView);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="settings" role="dialog" aria-label="Settings">
        <header className="card-header">
          <h2>Settings</h2>
          <button className="button" onClick={onClose}>
            Done
          </button>
        </header>
        {!view ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <GoogleSection view={view} onChange={setView} />
            <ClaudeSection view={view} onChange={setView} />
            <WeatherSection view={view} onChange={setView} />
            <CommuteSection view={view} onChange={setView} />
            <section className="settings-section">
              <h3>Tasks</h3>
              <p className="muted small">
                Tasks live in Hub itself. Add them from the Tasks card or with quick capture; they're saved on this computer.
              </p>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
