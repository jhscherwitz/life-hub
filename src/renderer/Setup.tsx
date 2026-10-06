import { useState, type FormEvent, type ReactNode } from 'react';
import { STARTER_LAYOUTS } from '../shared/layout';
import type { SettingsView } from '../shared/types';
import { Icon } from './components/Icon';
import { errorText } from './hooks';
import { Orb } from './pages/ChatPage';

const GEMINI_KEY_URL = 'https://aistudio.google.com/apikey';
const STEPS = ['name', 'google', 'ai', 'canvas', 'layout', 'done'] as const;
type Step = (typeof STEPS)[number];

/** One step's buttons: Skip (or Back) on the left, the main one on the right. */
function Buttons({ onSkip, skipLabel = 'Skip for now', children }: { onSkip?: () => void; skipLabel?: string; children: ReactNode }) {
  return (
    <div className="setup-buttons">
      {onSkip ? (
        <button type="button" className="link-button" onClick={onSkip}>
          {skipLabel}
        </button>
      ) : (
        <span />
      )}
      {children}
    </div>
  );
}

/**
 * First-run setup: a name for the AI to use, then Google, free AI, Canvas
 * and a starting layout. Every step but the name can be skipped and done
 * later in Settings. Takes about two minutes.
 */
export function Setup({ view, onChange, onDone }: { view: SettingsView; onChange: (v: SettingsView) => void; onDone: () => void }) {
  const [step, setStep] = useState<Step>('name');
  const [name, setName] = useState(view.profile?.name ?? '');
  const [key, setKey] = useState('');
  const [canvas, setCanvas] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const at = STEPS.indexOf(step);
  const next = () => {
    setError(null);
    setStep(STEPS[Math.min(at + 1, STEPS.length - 1)]);
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      next();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const finish = async () => {
    onChange(await window.hub.setProfile({ setupDone: true }));
    onDone();
  };

  const google = view.google;
  const aiOn = view.ai && 'provider' in view.ai && view.ai.provider !== 'off';

  return (
    <div className="setup" role="dialog" aria-label="Set up Life Hub">
      <div className="setup-card" key={step}>
        <div className="setup-dots" aria-hidden="true">
          {STEPS.map((s, i) => (
            <span key={s} className={i <= at ? 'is-on' : ''} />
          ))}
        </div>

        {step === 'name' && (
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (name.trim()) void run(async () => onChange(await window.hub.setProfile({ name })));
            }}
          >
            <Orb size={34} />
            <h1>Welcome to Life Hub</h1>
            <p>Your day in one place: calendar, email, tasks, music, a browser, and an AI that can do things for you. Let's set it up. It takes about two minutes.</p>
            <label className="setup-label">
              What should we call you?
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your first name" autoFocus maxLength={40} />
            </label>
            <p className="muted small">The AI uses it to greet you and to sign replies it drafts for you.</p>
            <Buttons>
              <button className="button button-primary" type="submit" disabled={busy || !name.trim()}>
                Continue
              </button>
            </Buttons>
          </form>
        )}

        {step === 'google' && (
          <div>
            <Icon name="mail" size={30} className="setup-icon" />
            <h1>Connect Google</h1>
            <p>See your Google Calendar and Gmail in Life Hub. The AI can sort your inbox, draft replies (it never sends them) and add events when you ask.</p>
            {google.connected ? (
              <p className="setup-ok">
                <Icon name="check" size={14} /> Connected{google.email ? ` as ${google.email}` : ''}
              </p>
            ) : !google.hasCredentials ? (
              <p className="muted small">This copy of Life Hub needs a Google connection set up first. You can do it later in Settings.</p>
            ) : (
              <p className="muted small">
                Your browser opens Google's sign-in page. If Google says the app isn't verified, click <b>Advanced</b>, then <b>Go to Life Hub</b>.
              </p>
            )}
            <Buttons onSkip={next}>
              {google.connected ? (
                <button className="button button-primary" onClick={next}>
                  Continue
                </button>
              ) : (
                <button
                  className="button button-primary"
                  disabled={busy || !google.hasCredentials}
                  onClick={() => void run(async () => onChange(await window.hub.googleSignIn()))}
                >
                  {busy ? 'Finish signing in in your browser…' : 'Sign in with Google'}
                </button>
              )}
            </Buttons>
          </div>
        )}

        {step === 'ai' && (
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (key.trim()) void run(async () => onChange(await window.hub.connectGemini(key.trim())));
            }}
          >
            <Orb size={30} />
            <h1>Turn on free AI</h1>
            <p>The AI chats, searches the web, sorts your email and does things for you. It runs on Google Gemini's free plan with your own key.</p>
            {aiOn ? (
              <p className="setup-ok">
                <Icon name="check" size={14} /> AI is on
              </p>
            ) : (
              <>
                <ol className="setup-steps">
                  <li>
                    Open{' '}
                    <button type="button" className="link-button" onClick={() => window.hub.openExternal(GEMINI_KEY_URL)}>
                      Google AI Studio
                    </button>{' '}
                    and sign in.
                  </li>
                  <li>
                    Click <b>Create API key</b> and copy it.
                  </li>
                  <li>Paste it here.</li>
                </ol>
                <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste your Gemini key" spellCheck={false} />
                <p className="muted small">Free, with a daily limit. Your key stays on this computer, encrypted.</p>
              </>
            )}
            <Buttons onSkip={next}>
              {aiOn ? (
                <button type="button" className="button button-primary" onClick={next}>
                  Continue
                </button>
              ) : (
                <button className="button button-primary" type="submit" disabled={busy || !key.trim()}>
                  {busy ? 'Checking…' : 'Turn on'}
                </button>
              )}
            </Buttons>
          </form>
        )}

        {step === 'canvas' && (
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (canvas.trim()) void run(async () => onChange(await window.hub.signInToCanvas(canvas.trim())));
            }}
          >
            <Icon name="tasks" size={30} className="setup-icon" />
            <h1>Using Canvas for school?</h1>
            <p>See your grades and what's due. Type your school's Canvas address, then sign in like you normally do. No key needed.</p>
            {view.canvas?.connected ? (
              <p className="setup-ok">
                <Icon name="check" size={14} /> Canvas is connected
              </p>
            ) : (
              <input value={canvas} onChange={(e) => setCanvas(e.target.value)} placeholder="canvas.yourschool.edu" spellCheck={false} />
            )}
            <Buttons onSkip={next} skipLabel="I don't use Canvas">
              {view.canvas?.connected ? (
                <button type="button" className="button button-primary" onClick={next}>
                  Continue
                </button>
              ) : (
                <button className="button button-primary" type="submit" disabled={busy || !canvas.trim()}>
                  {busy ? 'Finish signing in…' : 'Sign in to Canvas'}
                </button>
              )}
            </Buttons>
          </form>
        )}

        {step === 'layout' && (
          <div>
            <Icon name="grid" size={30} className="setup-icon" />
            <h1>Pick a starting dashboard</h1>
            <p>You can move, resize, add and remove widgets any time with Customize.</p>
            <div className="setup-layouts">
              {Object.entries(STARTER_LAYOUTS).map(([id, l]) => (
                <button key={id} className="setup-layout" disabled={busy} onClick={() => void run(async () => void (await window.hub.saveLayout(l.layout)))}>
                  <b>{l.label}</b>
                  <span>{l.blurb}</span>
                  <span className="setup-layout-count">{l.layout.length} widgets</span>
                </button>
              ))}
            </div>
            <Buttons onSkip={next} skipLabel="Keep the current one">
              <span />
            </Buttons>
          </div>
        )}

        {step === 'done' && (
          <div>
            <Orb size={40} />
            <h1>You're all set{view.profile?.name ? `, ${view.profile.name.split(' ')[0]}` : ''}!</h1>
            <p>A few things to try:</p>
            <ul className="setup-tips">
              <li>Ask the AI “what's my day look like?” or “reply to my coach saying I'll be there”.</li>
              <li>Open the Browser and highlight any text for Ask AI.</li>
              <li>Press Ctrl+K to search everything.</li>
            </ul>
            <Buttons>
              <button className="button button-primary" onClick={() => void finish()}>
                Open my dashboard
              </button>
            </Buttons>
          </div>
        )}

        {error && <p className="settings-error">{error}</p>}
      </div>
    </div>
  );
}
