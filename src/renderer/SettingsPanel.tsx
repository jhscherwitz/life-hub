import { Component, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useAnimatedClose } from './motion';
import { THEMES, type Place, type SettingsView } from '../shared/types';
import { errorText } from './hooks';
import { ReportButton } from './CrashScreen';

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
              Life Hub can read your calendar and inbox, save draft replies in Gmail, add events to your calendar, and archive, delete (to Trash) and star email
              when you or the AI ask. It never sends email: drafts wait in Gmail until you send them.
            </p>
          ) : (
            <p className="settings-warning small">
              To save draft replies in Gmail, Life Hub needs one more permission. Click <strong>Sign out</strong>, then <strong>Sign in with Google</strong>{' '}
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
          <p className="muted small">Paste the Client ID and Client secret from Google Cloud. The README has step-by-step instructions for getting them.</p>
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
            {!google.builtIn && (
              <button className="link-button" disabled={busy} onClick={() => setEditing(true)}>
                Change Client ID
              </button>
            )}
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

const GEMINI_KEY_URL = 'https://aistudio.google.com/apikey';
const OLLAMA_URL = 'https://ollama.com/download';

/** What the AI remembers about you, from chat ("remember I'm a junior"). Saved only on this computer. */
function MemoryList() {
  const [memories, setMemories] = useState<{ id: string; text: string }[] | null>(null);
  useEffect(() => {
    void window.hub.getPrefs?.().then((p) => setMemories(Array.isArray(p?.memories) ? p.memories : []));
  }, []);
  if (!memories) return null;
  return (
    <div className="memory-list">
      <p className="memory-head">What the AI remembers</p>
      {memories.length === 0 ? (
        <p className="muted small">Nothing yet. Tell it in chat, like “remember I'm a junior” or “from now on call me Jake”.</p>
      ) : (
        <ul>
          {memories.map((m) => (
            <li key={m.id}>
              <span>{m.text}</span>
              <button
                className="link-button"
                onClick={() => void window.hub.forgetMemory(m.id).then(() => setMemories((list) => (list ?? []).filter((x) => x.id !== m.id)))}
              >
                Forget
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">Saved only on this computer.</p>
    </div>
  );
}

/** Free AI only: a free Google Gemini key, or a model running on this computer. */
function AiSection({ view, onChange }: { view: SettingsView; onChange: (v: SettingsView) => void }) {
  const { ai } = view;
  const [choice, setChoice] = useState<'gemini' | 'ollama'>(ai.provider === 'ollama' ? 'ollama' : 'gemini');
  const [key, setKey] = useState('');
  const [models, setModels] = useState<string[] | null>(null);
  const { busy, error, run } = useAction();

  const connectGemini = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      onChange(await window.hub.connectGemini(key));
      setKey('');
    });
  };

  return (
    <section className="settings-section">
      <h3>Free AI</h3>
      <p className="muted small">
        Turns on the Chat page, inbox summaries, written briefings and smarter draft replies. Both choices are free. Without AI, Life Hub writes simpler
        versions itself.
      </p>

      {ai.provider !== 'off' ? (
        <div className="settings-actions">
          <span>
            <span className="status-dot ok" /> {ai.provider === 'gemini' ? 'Google Gemini' : 'Ollama on this computer'} is on
            {ai.model && <span className="muted"> · {ai.model}</span>}
          </span>
          <button className="link-button" disabled={busy} onClick={() => void run(async () => onChange(await window.hub.turnOffAi()))}>
            Turn off
          </button>
        </div>
      ) : (
        <>
          <div className="segmented">
            <button className={choice === 'gemini' ? 'active' : ''} onClick={() => setChoice('gemini')}>
              Free Gemini key
            </button>
            <button className={choice === 'ollama' ? 'active' : ''} onClick={() => setChoice('ollama')}>
              On this computer
            </button>
          </div>

          {choice === 'gemini' ? (
            <>
              <ol className="steps small">
                <li>
                  Open{' '}
                  <button className="link-button" onClick={() => window.hub.openExternal(GEMINI_KEY_URL)}>
                    Google AI Studio
                  </button>{' '}
                  and sign in with any Google account.
                </li>
                <li>Click Create API key, then copy it.</li>
                <li>Paste it here and click Turn on.</li>
              </ol>
              <form onSubmit={connectGemini} className="settings-inline">
                <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste your Gemini key" spellCheck={false} />
                <button className="button button-primary" type="submit" disabled={busy || !key.trim()}>
                  {busy ? 'Checking…' : 'Turn on'}
                </button>
              </form>
              <p className="muted small">
                Free, with a daily limit. Life Hub sends your calendar, task titles and email previews to Google to do this, and Google may use what it sees on
                the free plan to improve its AI.
              </p>
            </>
          ) : (
            <>
              <ol className="steps small">
                <li>
                  Install{' '}
                  <button className="link-button" onClick={() => window.hub.openExternal(OLLAMA_URL)}>
                    Ollama
                  </button>{' '}
                  and open it.
                </li>
                <li>In Ollama, download a model (llama3.2 is a good small one).</li>
                <li>Click Find my models, then pick one.</li>
              </ol>
              <div className="settings-actions">
                <button className="button" disabled={busy} onClick={() => void run(async () => setModels(await window.hub.listOllamaModels()))}>
                  {busy && !models ? 'Looking…' : 'Find my models'}
                </button>
              </div>
              {models && models.length === 0 && (
                <p className="settings-warning small">Ollama is running but has no models yet. Download one in Ollama first.</p>
              )}
              {models && models.length > 0 && (
                <ul className="list place-results">
                  {models.map((m) => (
                    <li key={m}>
                      <button className="place-option" disabled={busy} onClick={() => void run(async () => onChange(await window.hub.useOllama(m)))}>
                        {m}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="muted small">Fully private: nothing leaves your computer. Needs a fairly recent computer, and answers are slower.</p>
            </>
          )}
        </>
      )}
      {error && <p className="settings-error">{error}</p>}
    </section>
  );
}

function AlertsSection({ view, onChange }: { view: SettingsView; onChange: (v: SettingsView) => void }) {
  const alerts = view.alerts!;
  const { busy, error, run } = useAction();
  const set = (key: keyof typeof alerts) => (e: { target: { checked: boolean } }) =>
    void run(async () => onChange(await window.hub.setAlerts!({ [key]: e.target.checked })));
  return (
    <section className="settings-section">
      <h3>Alerts</h3>
      <p className="muted small">
        Pop-ups on this computer{view.phone?.on ? ', and on your phone' : ''} for things worth knowing right away.
        {!view.phone?.on && ' Set up phone reminders above to get them on your phone too.'}
      </p>
      <label className="settings-check">
        <input type="checkbox" checked={alerts.events} disabled={busy} onChange={set('events')} />
        Events about to start, and when to leave (uses your Commute widget's home address)
      </label>
      <label className="settings-check">
        <input type="checkbox" checked={alerts.email} disabled={busy} onChange={set('email')} />
        New email from a person that needs a reply
      </label>
      <label className="settings-check">
        <input type="checkbox" checked={alerts.school} disabled={busy} onChange={set('school')} />
        Canvas announcements and grade changes
      </label>
      {error && <p className="settings-error">{error}</p>}
    </section>
  );
}

function PhoneSection({ view, onChange }: { view: SettingsView; onChange: (v: SettingsView) => void }) {
  const phone = view.phone!;
  const { busy, error, run } = useAction();
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <section className="settings-section">
      <h3>Phone reminders</h3>
      <p className="muted small">
        Get your reminders on your phone, free, through the ntfy app (no account). Reminders up to 3 days ahead arrive on time even if this computer is off.
      </p>
      {!phone.on ? (
        <div className="settings-actions">
          <button className="button button-primary" disabled={busy} onClick={() => void run(async () => onChange(await window.hub.phoneOn()))}>
            Set up phone reminders
          </button>
        </div>
      ) : (
        <>
          <ol className="steps small">
            <li>
              Install the free{' '}
              <button className="link-button" onClick={() => window.hub.openExternal('https://docs.ntfy.sh/subscribe/phone/')}>
                ntfy app
              </button>{' '}
              on your phone (iPhone or Android).
            </li>
            <li>
              In ntfy, tap <strong>+</strong> (Subscribe to topic) and type this name exactly:
            </li>
          </ol>
          <div className="phone-topic">
            <code>{phone.topic}</code>
            <button
              className="button"
              onClick={() => {
                void navigator.clipboard.writeText(phone.topic ?? '').then(() => setCopied(true));
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <ol className="steps small" start={3}>
            <li>Click Send a test. It should pop up on your phone in a few seconds.</li>
          </ol>
          <div className="settings-actions">
            <button
              className="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await window.hub.phoneTest();
                  setSent(true);
                })
              }
            >
              {sent ? 'Sent! Check your phone' : 'Send a test'}
            </button>
            <button className="link-button" disabled={busy} onClick={() => void run(async () => onChange(await window.hub.phoneOff()))}>
              Turn off
            </button>
          </div>
          <p className="muted small">
            The name is long and random so nobody can guess it. Reminder text passes through ntfy.sh, so don't put passwords in reminders.
          </p>
        </>
      )}
      {error && <p className="settings-error">{error}</p>}
    </section>
  );
}

function ThemeSection({ view, onChange }: { view: SettingsView; onChange: (v: SettingsView) => void }) {
  const { error, run } = useAction();
  return (
    <section className="settings-section">
      <h3>Theme</h3>
      <p className="muted small">The accent colour for buttons, highlights and glows.</p>
      <div className="theme-picker" role="radiogroup" aria-label="Theme">
        {THEMES.map((t) => (
          <button
            key={t.id}
            role="radio"
            aria-checked={view.theme === t.id}
            className={view.theme === t.id ? 'is-on' : ''}
            onClick={() => void run(async () => onChange(await window.hub.setTheme(t.id)))}
          >
            <span className="theme-swatch" style={{ background: `linear-gradient(135deg, ${t.color}, ${t.light})` }} />
            {t.name}
          </button>
        ))}
      </div>
      {error && <p className="settings-error">{error}</p>}
    </section>
  );
}

function CanvasSection({ view, onChange }: { view: SettingsView; onChange: (v: SettingsView) => void }) {
  const canvas = view.canvas!;
  const [address, setAddress] = useState('');
  const [token, setToken] = useState('');
  const [useToken, setUseToken] = useState(false);
  const { busy, error, run } = useAction();
  const canSignIn = typeof window.hub.signInToCanvas === 'function';
  const settingsUrl = (() => {
    try {
      return address.trim() ? `${new URL(/^https?:\/\//.test(address.trim()) ? address.trim() : `https://${address.trim()}`).origin}/profile/settings` : null;
    } catch {
      return null;
    }
  })();

  const connect = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      onChange(await window.hub.connectCanvas(address, token));
      setToken('');
    });
  };
  const signIn = (where: string) => void run(async () => onChange(await window.hub.signInToCanvas(where)));

  return (
    <section className="settings-section">
      <h3>Canvas grades</h3>
      <p className="muted small">Shows your current grade in each class, and puts Canvas assignments in Due soon and search. Free.</p>
      {canvas.connected ? (
        <div className="settings-actions">
          <span>
            <span className="status-dot ok" /> Connected <span className="muted">· {canvas.origin?.replace('https://', '')}</span>
          </span>
          {canvas.signedIn && canvas.origin && (
            <button className="link-button" disabled={busy} onClick={() => signIn(canvas.origin!)} title="Use this if Canvas says your sign-in ran out">
              {busy ? 'Waiting for Canvas…' : 'Sign in again'}
            </button>
          )}
          <button className="link-button" disabled={busy} onClick={() => void run(async () => onChange(await window.hub.disconnectCanvas()))}>
            Disconnect
          </button>
        </div>
      ) : !useToken && canSignIn ? (
        <>
          <form
            className="settings-stack"
            onSubmit={(e) => {
              e.preventDefault();
              signIn(address);
            }}
          >
            <div className="settings-inline">
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="canvas.yourschool.edu"
                spellCheck={false}
                aria-label="Canvas address"
              />
              <button className="button button-primary" type="submit" disabled={busy || !address.trim()}>
                {busy ? 'Waiting for Canvas…' : 'Sign in to Canvas'}
              </button>
            </div>
          </form>
          <p className="muted small">
            {busy
              ? 'Finish signing in in the Canvas window. It closes by itself when you’re done.'
              : 'Type the address your browser shows on Canvas. A window opens with your school’s normal Canvas sign-in. Life Hub never sees your password.'}
          </p>
          <button className="link-button small" onClick={() => setUseToken(true)}>
            Use an access token instead
          </button>
        </>
      ) : (
        <>
          <ol className="steps small">
            <li>Type your school's Canvas address below (what your browser shows on Canvas, like canvas.yourschool.edu).</li>
            <li>
              In Canvas, open{' '}
              {settingsUrl ? (
                <button className="link-button" onClick={() => window.hub.openExternal(settingsUrl)}>
                  Account, Settings
                </button>
              ) : (
                'Account, Settings'
              )}
              , scroll to Approved Integrations, and click <strong>+ New Access Token</strong>.
            </li>
            <li>For Purpose type Life Hub, leave the date empty, click Generate Token, and copy it.</li>
            <li>Paste it here and click Connect.</li>
          </ol>
          <form onSubmit={connect} className="settings-stack">
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="canvas.yourschool.edu" spellCheck={false} />
            <div className="settings-inline">
              <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Paste your access token" spellCheck={false} />
              <button className="button button-primary" type="submit" disabled={busy || !address.trim() || !token.trim()}>
                {busy ? 'Checking…' : 'Connect'}
              </button>
            </div>
          </form>
          <p className="muted small">
            The token is saved encrypted on this computer and only sent to your school's Canvas. If there's no New Access Token button, your school has turned
            them off.
          </p>
          {canSignIn && (
            <button className="link-button small" onClick={() => setUseToken(false)}>
              Sign in to Canvas instead
            </button>
          )}
        </>
      )}
      {error && <p className="settings-error">{error}</p>}
    </section>
  );
}

function lastRunText(iso: string | undefined): string {
  if (!iso) return "Hasn't run yet.";
  const at = new Date(iso);
  const sameDay = at.toDateString() === new Date().toDateString();
  const time = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `Last ran ${sameDay ? 'today' : at.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })} at ${time}.`;
}

function MorningSection({ view, onChange }: { view: SettingsView; onChange: (v: SettingsView) => void }) {
  const { morning, startAtLogin } = view;
  const [time, setTime] = useState(morning.time);
  const { busy, error, run } = useAction();
  const [running, setRunning] = useState(false);

  const saveTime = (value: string) => {
    setTime(value);
    if (value) void run(async () => onChange(await window.hub.setMorning({ enabled: morning.enabled, time: value })));
  };

  return (
    <section className="settings-section">
      <h3>Morning update</h3>
      <p className="muted small">
        Each morning Life Hub refreshes everything, writes your briefing and shows a notification. Click the notification to open the dashboard. If your
        computer is asleep or off at that time, it runs as soon as you're back.
      </p>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={morning.enabled}
          disabled={busy}
          onChange={(e) => void run(async () => onChange(await window.hub.setMorning({ enabled: e.target.checked, time: morning.time })))}
        />
        Run the morning update at
        <input type="time" value={time} disabled={busy || !morning.enabled} onChange={(e) => saveTime(e.target.value)} />
      </label>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={startAtLogin.enabled}
          disabled={busy || !startAtLogin.available}
          onChange={(e) => void run(async () => onChange(await window.hub.setStartAtLogin(e.target.checked)))}
        />
        Start Life Hub in the {window.hub.platform === 'darwin' ? 'menu bar' : 'tray'} when I log in
      </label>
      {!startAtLogin.available && (
        <p className="muted small">
          This works once Life Hub is installed. You're running it from the terminal right now; the README explains how to install it.
        </p>
      )}
      <div className="settings-actions">
        <button
          className="button"
          disabled={running}
          onClick={() => {
            setRunning(true);
            void run(async () => onChange(await window.hub.runMorningNow())).finally(() => setRunning(false));
          }}
        >
          {running ? 'Running…' : 'Run it now'}
        </button>
        <span className="muted small">{lastRunText(morning.lastRunAt)}</span>
      </div>
      {error && <p className="settings-error">{error}</p>}
    </section>
  );
}

/** How blurry the background is. The page behind Settings changes as you drag; it's saved when you let go. */
function BlurSlider({ view, onChange }: { view: SettingsView; onChange: (v: SettingsView) => void }) {
  const [blur, setBlur] = useState(view.background.blur ?? 30);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const change = (px: number) => {
    setBlur(px);
    onChange({ ...view, background: { ...view.background, blur: px } });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void window.hub.setBackgroundBlur(px).then(onChange), 300);
  };
  return (
    <label className="blur-slider">
      <span className="blur-slider-head">
        <span>Blur</span>
        <span className="muted small">{blur === 0 ? 'Sharp' : `${blur}px`}</span>
      </span>
      <input type="range" min={0} max={60} step={1} value={blur} onChange={(e) => change(Number(e.target.value))} aria-label="Background blur" />
      <span className="blur-slider-ends muted small">
        <span>Sharp</span>
        <button type="button" className="link-button" onClick={() => change(30)} disabled={blur === 30}>
          Reset
        </button>
        <span>Very blurry</span>
      </span>
    </label>
  );
}

function BackgroundSection({ view, onChange }: { view: SettingsView; onChange: (v: SettingsView) => void }) {
  const { busy, error, run } = useAction();
  const custom = view.background.custom;

  return (
    <section className="settings-section">
      <h3>Background</h3>
      <p className="muted small">
        {custom
          ? 'Using your own picture. Life Hub keeps a copy, blurs it and darkens it so the text stays easy to read.'
          : 'Using the built-in mountains. Pick any picture and Life Hub blurs and darkens it behind everything.'}
      </p>
      {typeof window.hub.setBackgroundBlur === 'function' && <BlurSlider view={view} onChange={onChange} />}
      <div className="settings-actions">
        <button className="button" disabled={busy} onClick={() => void run(async () => onChange(await window.hub.chooseBackground()))}>
          {custom ? 'Choose another picture' : 'Choose picture'}
        </button>
        {custom && (
          <button className="button" disabled={busy} onClick={() => void run(async () => onChange(await window.hub.resetBackground()))}>
            Use the mountains
          </button>
        )}
      </div>
      {error && <p className="settings-error">{error}</p>}
    </section>
  );
}

function RestartNotice() {
  return (
    <section className="settings-section">
      <h3>Morning update</h3>
      <p className="settings-warning small">
        Life Hub was updated while it was running. Quit Life Hub from the {window.hub.platform === 'darwin' ? 'menu bar' : 'tray'} and start it again to finish
        the update.
      </p>
    </section>
  );
}

/** Your name for the AI, and a backup of everything you made in Life Hub. */
function YouSection({ view, onChange }: { view: SettingsView; onChange: (v: SettingsView) => void }) {
  const { busy, error, run } = useAction();
  const [name, setName] = useState(view.profile?.name ?? '');
  const [saved, setSaved] = useState<string | null>(null);
  const changed = name.trim() !== (view.profile?.name ?? '');
  return (
    <section className="settings-section">
      <h3>You</h3>
      <form
        className="settings-inline"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void run(async () => {
            onChange(await window.hub.setProfile({ name }));
            setSaved('Saved.');
          });
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" maxLength={40} aria-label="Your name" />
        <button className="button" type="submit" disabled={busy || !changed}>
          Save
        </button>
      </form>
      <p className="muted small">The AI uses it to greet you and to sign replies it drafts.</p>
      {typeof window.hub.exportBackup === 'function' && (
        <>
          <div className="settings-inline">
            <button className="button" disabled={busy} onClick={() => void run(async () => setSaved((await window.hub.exportBackup()) ? 'Backup saved.' : null))}>
              Save a backup
            </button>
            <button className="button" disabled={busy} onClick={() => void run(async () => void (await window.hub.importBackup()))}>
              Restore a backup
            </button>
          </div>
          <p className="muted small">
            A file with your tasks, notes, layout, habits, sorting rules, what the AI remembers and your bookmarks. Passwords and sign-ins are never in it, so you
            sign in again after restoring.
          </p>
        </>
      )}
      <div className="settings-inline">
        <button className="button" onClick={() => void window.hub.setProfile({ setupDone: false }).then(onChange)}>
          Run setup again
        </button>
      </div>
      {saved && <p className="muted small">{saved}</p>}
      {error && <p className="settings-error">{error}</p>}
    </section>
  );
}

/** If Settings ever breaks, show what happened instead of a blank window. */
export class SettingsErrorBoundary extends Component<{ onClose: () => void; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="overlay">
        <div className="settings" role="dialog" aria-label="Settings">
          <header className="card-header">
            <h2>Settings</h2>
            <button className="button" onClick={this.props.onClose}>
              Close
            </button>
          </header>
          <section className="settings-section">
            <p className="settings-error">Settings couldn't open: {this.state.error.message}</p>
            <p className="muted small">
              Quit Life Hub from the {window.hub.platform === 'darwin' ? 'menu bar' : 'tray'} and start it again. If it keeps happening, report it below.
            </p>
            <ReportButton error={this.state.error} where="Settings" />
          </section>
        </div>
      </div>
    );
  }
}

export function SettingsPanel({ onClose, onChange }: { onClose: () => void; onChange?: (view: SettingsView) => void }) {
  const [closing, close] = useAnimatedClose(onClose);
  const [view, setViewState] = useState<SettingsView | null>(null);
  // Let the dashboard see changes straight away (a new background picture, say).
  const setView = (next: SettingsView) => {
    setViewState(next);
    onChange?.(next);
  };

  useEffect(() => {
    void window.hub.getSettings().then(setView);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  return (
    <div className={`overlay ${closing ? 'is-closing' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="settings" role="dialog" aria-label="Settings">
        <header className="card-header">
          <h2>Settings</h2>
          <button className="button" onClick={close}>
            Done
          </button>
        </header>
        {!view ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            {view.profile && <YouSection view={view} onChange={setView} />}
            <GoogleSection view={view} onChange={setView} />
            {view.ai && 'provider' in view.ai && <AiSection view={view} onChange={setView} />}
            {view.ai && 'provider' in view.ai && view.ai.provider !== 'off' && typeof window.hub.getPrefs === 'function' && (
              <section className="settings-section">
                <MemoryList />
              </section>
            )}
            {/* Missing when the screen updated but the rest of Life Hub is still the old version. */}
            {view.morning ? <MorningSection view={view} onChange={setView} /> : <RestartNotice />}
            {view.canvas && <CanvasSection view={view} onChange={setView} />}
            <WeatherSection view={view} onChange={setView} />
            {/* Missing when the screen updated but the rest of Life Hub is still the old version. */}
            {view.phone && <PhoneSection view={view} onChange={setView} />}
            {view.alerts && <AlertsSection view={view} onChange={setView} />}
            {view.theme && <ThemeSection view={view} onChange={setView} />}
            {view.background && <BackgroundSection view={view} onChange={setView} />}
            <section className="settings-section">
              <h3>Tasks</h3>
              <p className="muted small">Tasks live in Life Hub itself. Add them from the Tasks card or with quick capture; they're saved on this computer.</p>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
