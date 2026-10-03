import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ActionResult } from '../../shared/actions';
import type { ChatTurn } from '../../shared/types';
import { Icon, type IconName } from '../components/Icon';
import { errorText } from '../hooks';

const MAX_PICTURES = 4;
/** Pictures are shrunk to fit this many pixels on their longest side before sending. */
const MAX_SIDE = 1600;

/** Reads a picture and shrinks it, so it sends quickly. Gives a data: URL. */
async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    // PNG keeps screenshots' text sharp; photos are much smaller as JPEG.
    return file.type === 'image/png' && canvas.width * canvas.height < 1_500_000 ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.86);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function imageFiles(list: FileList | null | undefined): File[] {
  return [...(list ?? [])].filter((f) => f.type.startsWith('image/'));
}

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
  const picker = useRef<HTMLInputElement>(null);
  const [pictures, setPictures] = useState<string[]>([]);
  const [dropping, setDropping] = useState(false);
  const addPictures = async (files: File[]) => {
    if (!files.length) return;
    try {
      const shrunk = await Promise.all(files.slice(0, MAX_PICTURES).map(shrink));
      setPictures((p) => [...p, ...shrunk].slice(0, MAX_PICTURES));
      input.current?.focus();
    } catch {
      setError("That picture couldn't be read. Try a PNG or JPEG.");
    }
  };
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages, busy]);

  async function send(text: string) {
    const attached = pictures;
    const content = text.trim() || (attached.length ? (attached.length === 1 ? 'What’s in this picture?' : 'What’s in these pictures?') : '');
    if (!content || busy) return;
    const next: ChatTurn[] = [...messages, { role: 'user', content, ...(attached.length && { images: attached }) }];
    onMessages(next);
    setDraft('');
    setPictures([]);
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
    <section
      className={`card chat ${panel ? 'is-panel' : ''} ${dropping ? 'is-dropping' : ''}`}
      onDragOver={(e) => {
        if (![...e.dataTransfer.items].some((i) => i.type.startsWith('image/'))) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(e) => e.currentTarget.contains(e.relatedTarget as Node) || setDropping(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDropping(false);
        void addPictures(imageFiles(e.dataTransfer.files));
      }}
    >
      {dropping && <div className="chat-drop">Drop a picture to ask about it</div>}
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
            {m.images && m.images.length > 0 && (
              <div className={`bubble-pics bubble-pics-${m.role}`}>
                {m.images.map((src, k) => (
                  <img key={k} src={src} alt="" />
                ))}
              </div>
            )}
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
      {pictures.length > 0 && (
        <div className="chat-pics">
          {pictures.map((src, k) => (
            <span key={k} className="chat-pic">
              <img src={src} alt="" />
              <button type="button" onClick={() => setPictures(pictures.filter((_, j) => j !== k))} aria-label="Remove picture" title="Remove">
                <Icon name="x" size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      <form className="chat-input" onSubmit={submit}>
        <button
          type="button"
          className="button chat-attach"
          onClick={() => picker.current?.click()}
          disabled={busy || pictures.length >= MAX_PICTURES}
          aria-label="Add a picture"
          title="Add a picture (or paste one with Ctrl+V)"
        >
          <Icon name="image" size={15} />
        </button>
        <input
          ref={picker}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            void addPictures(imageFiles(e.target.files));
            e.target.value = '';
          }}
        />
        <input
          ref={input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPaste={(e) => {
            const files = imageFiles(e.clipboardData.files);
            if (!files.length) return;
            e.preventDefault();
            void addPictures(files);
          }}
          placeholder={pictures.length ? 'Ask about the picture…' : panel ? 'Ask, or say “add quiz friday 3pm”…' : 'Ask anything, or say “add quiz friday 3pm”…'}
          disabled={busy}
          autoFocus={!panel}
        />
        <button className="button button-primary" type="submit" disabled={busy || (!draft.trim() && !pictures.length)} aria-label="Send">
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
