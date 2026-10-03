import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ChatTurn } from '../../shared/types';
import { Icon } from '../components/Icon';
import { errorText } from '../hooks';

const SUGGESTIONS = ["What's my day look like?", "Who's waiting on a reply from me?", 'What should I do next?', 'Write a short reply to my newest email'];

/** Talk to the free AI about your day. The conversation lasts until Life Hub closes. */
export function ChatPage(props: { aiOn: boolean; messages: ChatTurn[]; onMessages: (m: ChatTurn[]) => void; onOpenSettings: () => void }) {
  const { aiOn, messages, onMessages, onOpenSettings } = props;
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
      const reply = await window.hub.chat(next);
      onMessages([...next, { role: 'assistant', content: reply }]);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (!aiOn || !window.hub.chat) {
    return (
      <section className="card chat-off">
        <h2 className="chat-off-title">Chat with your day</h2>
        <p className="muted">
          Ask about your calendar, inbox and tasks: "What's my afternoon like?" or "Who's waiting on me?". It's free: turn on a free Gemini key, or
          AI on this computer, in Settings.
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
    <section className="card chat">
      <div className="chat-log">
        {messages.length === 0 && (
          <div className="chat-empty">
            <p className="chat-off-title">Ask anything about your day</p>
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
          <div key={i} className={`bubble bubble-${m.role}`}>
            {m.content}
          </div>
        ))}
        {busy && <div className="bubble bubble-assistant bubble-thinking">Thinking…</div>}
        {error && <p className="settings-error">{error}</p>}
        <div ref={end} />
      </div>
      <form className="chat-input" onSubmit={submit}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask about your day…" disabled={busy} autoFocus />
        <button className="button button-primary" type="submit" disabled={busy || !draft.trim()} aria-label="Send">
          <Icon name="send" size={15} />
        </button>
        {messages.length > 0 && (
          <button type="button" className="button" disabled={busy} onClick={() => onMessages([])}>
            Clear
          </button>
        )}
      </form>
    </section>
  );
}
