import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ActionResult } from '../../shared/actions';
import type { ChatTurn } from '../../shared/types';
import { Icon, type IconName } from '../components/Icon';
import { errorText } from '../hooks';

const SUGGESTIONS = [
  "What's my day look like?",
  "Who's waiting on a reply from me?",
  'Add chem quiz friday 3pm',
  'Remind me to call mom at 6pm',
  'Count down to fall break on oct 15',
  'What should I do next?',
  'How are my stocks doing?',
];

/** Talk to the free AI about your day. The conversation lasts until Life Hub closes. */
const ACTION_ICON: Record<ActionResult['type'], IconName> = {
  add_task: 'tasks',
  add_countdown: 'timer',
  add_note: 'info',
  tick_habit: 'sparkle',
  remind: 'bolt',
  set_holding: 'trend',
  remove_holding: 'trend',
};

/** A small card under a reply saying what the AI did, with Undo. */
function ActionCard({ action, onUndone }: { action: ActionResult & { undone?: boolean }; onUndone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className={`action-card ${action.ok ? '' : 'is-failed'} ${action.undone ? 'is-undone' : ''}`}>
      <span className="action-icon">
        <Icon name={action.ok ? ACTION_ICON[action.type] : 'alert'} size={13} />
      </span>
      <span className="action-text">
        <b>{action.undone ? 'Undone' : action.label}</b> {action.detail}
      </span>
      {action.ok && action.undo && !action.undone && (
        <button
          className="link-button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void window.hub
              .undoAction(action.undo!)
              .then(onUndone)
              .finally(() => setBusy(false));
          }}
        >
          Undo
        </button>
      )}
    </div>
  );
}

export function ChatPage(props: {
  aiOn: boolean;
  messages: ChatTurn[];
  onMessages: (m: ChatTurn[]) => void;
  onOpenSettings: () => void;
  /** A question from search to send straight away. */
  ask?: string | null;
  onAsked?: () => void;
  /** Shown in the panel on the right, beside every page. */
  panel?: boolean;
}) {
  const { aiOn, messages, onMessages, onOpenSettings, ask, onAsked, panel = false } = props;
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages, busy]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    const next: ChatTurn[] = [...messages, { role: 'user', content }];
    onMessages(next);
    setDraft('');
    setBusy(true);
    setError(null);
    try {
      // Chat that can do things, when this version of Life Hub has it.
      if (typeof window.hub.chatAct === 'function') {
        const { reply, actions } = await window.hub.chatAct(next);
        onMessages([...next, { role: 'assistant', content: reply, ...(actions.length && { actions }) }]);
      } else {
        const reply = await window.hub.chat(next);
        onMessages([...next, { role: 'assistant', content: reply }]);
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  // A question asked from search: send it once, or leave it in the box if AI is off.
  useEffect(() => {
    if (!ask) return;
    if (aiOn && typeof window.hub.chat === 'function') void send(ask);
    else setDraft(ask);
    input.current?.focus();
    onAsked?.();
  }, [ask]);

  if (!aiOn || !window.hub.chat) {
    return (
      <section className={`card chat-off ${panel ? 'is-panel' : ''}`}>
        <h2 className="chat-off-title">Chat with your day</h2>
        <p className="muted">
          Ask about your calendar, inbox and tasks: "What's my afternoon like?" or "Who's waiting on me?". It's free: turn on a free Gemini key, or AI on this
          computer, in Settings.
        </p>
        <button className="button button-primary" onClick={onOpenSettings}>
          Turn on free AI
        </button>
      </section>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send(draft);
  };

  return (
    <section className={`card chat ${panel ? 'is-panel' : ''}`}>
      <div className="chat-log">
        {messages.length === 0 && (
          <div className="chat-empty">
            <p className="chat-off-title">Ask about your day, or tell it to do something</p>
            <p className="muted small">It can add tasks, countdowns, notes and reminders, and tick off daily tasks. Everything it does has an Undo.</p>
            <div className="chat-suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="tag tag-button" onClick={() => void send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`bubble-group bubble-group-${m.role}`}>
            <div className={`bubble bubble-${m.role}`}>{m.content}</div>
            {m.actions?.map((a, j) => (
              <ActionCard
                key={j}
                action={a}
                onUndone={() =>
                  onMessages(messages.map((t, k) => (k === i ? { ...t, actions: t.actions?.map((x, y) => (y === j ? { ...x, undone: true } : x)) } : t)))
                }
              />
            ))}
          </div>
        ))}
        {busy && <div className="bubble bubble-assistant bubble-thinking">Thinking…</div>}
        {error && <p className="settings-error">{error}</p>}
        <div ref={end} />
      </div>
      <form className="chat-input" onSubmit={submit}>
        <input
          ref={input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={panel ? 'Ask, or say “add quiz friday 3pm”…' : 'Ask anything, or say “add quiz friday 3pm”…'}
          disabled={busy}
          autoFocus={!panel}
        />
        <button className="button button-primary" type="submit" disabled={busy || !draft.trim()} aria-label="Send">
          <Icon name="send" size={15} />
        </button>
        {messages.length > 0 && !panel && (
          <button type="button" className="button" disabled={busy} onClick={() => onMessages([])}>
            Clear
          </button>
        )}
      </form>
    </section>
  );
}
