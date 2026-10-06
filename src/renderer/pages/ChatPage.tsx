import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import type { ActionResult } from '../../shared/actions';
import type { ToolStep } from '../../shared/tools';
import type { ChatTurn } from '../../shared/types';
import { MicButton, VoiceBar, useVoice } from '../components/Voice';
import { Icon, type IconName } from '../components/Icon';
import { Markdown } from '../components/Markdown';
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

const SUGGESTIONS: { icon: IconName; text: string }[] = [
  { icon: 'calendar', text: "What's my day look like?" },
  { icon: 'trend', text: 'How are my stocks doing this year?' },
  { icon: 'globe', text: "What's happening in the news today?" },
  { icon: 'mail', text: "Who's waiting on a reply from me?" },
  { icon: 'bolt', text: 'Remind me to call mom at 6pm' },
];

function hello(hour: number): string {
  if (hour < 5) return 'Up late?';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Life Hub AI's mark: a little starburst that turns while it works. */
export function Spark({ size = 18, working = false }: { size?: number; working?: boolean }) {
  const rays = Array.from({ length: 10 }, (_, i) => i * 36);
  return (
    <svg className={`spark ${working ? 'is-working' : ''}`} width={size} height={size} viewBox="-12 -12 24 24" aria-hidden="true">
      {rays.map((deg, i) => (
        <rect key={deg} x="-1.25" y={i % 2 ? -9 : -11} width="2.5" height={i % 2 ? 7.5 : 9.5} rx="1.25" transform={`rotate(${deg})`} />
      ))}
    </svg>
  );
}

/** "Searched the web" above a reply; opens to show what it looked up and where. */
function Steps({ steps }: { steps: ToolStep[] }) {
  const [open, setOpen] = useState(false);
  const sources = steps.flatMap((s) => s.sources ?? []);
  const title = steps.length === 1 ? steps[0].label : `Looked up ${steps.length} things`;
  return (
    <div className={`steps ${open ? 'is-open' : ''}`}>
      <button type="button" className="steps-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon name={steps.some((s) => s.name === 'web_search' || s.name === 'read_page') ? 'globe' : 'search'} size={13} />
        <span>{title}</span>
        {sources.length > 0 && <span className="steps-count">{sources.length} sources</span>}
        <Icon name="chevron" size={12} className="steps-chevron" />
      </button>
      {open && (
        <ol className="steps-list">
          {steps.map((s, i) => (
            <li key={i} className={s.ok ? '' : 'is-failed'}>
              <span className="steps-label">
                {s.label}
                {s.detail && <em> {s.detail}</em>}
                {!s.ok && <em> (didn’t work)</em>}
              </span>
              {s.sources?.map((src, j) => {
                let host = src.title;
                try {
                  host = new URL(src.url).hostname.replace(/^www\./, '');
                } catch {
                  // Keep the title.
                }
                return (
                  <a key={j} className="steps-source" href={src.url} target="_blank" rel="noreferrer" title={src.url}>
                    <span className="steps-source-title">{src.title}</span>
                    {host !== src.title && <span className="steps-source-host">{host}</span>}
                  </a>
                );
              })}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Their message; highlighted text they asked about shows as a quote above it. */
function UserText({ text }: { text: string }) {
  const lines = text.split('\n');
  const quoted: string[] = [];
  while (lines.length && lines[0].startsWith('>')) quoted.push(lines.shift()!.replace(/^>\s?/, ''));
  const rest = lines.join('\n').trim();
  return (
    <div className="msg-user-text">
      {quoted.length > 0 && <div className="msg-quote">{quoted.join('\n')}</div>}
      {rest}
    </div>
  );
}

/** Copies a reply, and says so for a moment. */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="msg-tool"
      title={copied ? 'Copied' : 'Copy'}
      aria-label="Copy"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        });
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} size={13} />
    </button>
  );
}

/** Talk to the free AI about your day. The conversation lasts until Life Hub closes. */
const ACTION_ICON: Record<ActionResult['type'], IconName> = {
  add_task: 'tasks',
  add_event: 'calendar',
  reply: 'send',
  new_email: 'send',
  email: 'mail',
  mail_rule: 'sliders',
  remove_rule: 'sliders',
  remember: 'sparkle',
  forget: 'sparkle',
  add_countdown: 'timer',
  add_grocery: 'cart',
  add_note: 'info',
  tick_habit: 'sparkle',
  remind: 'bolt',
  set_holding: 'trend',
  remove_holding: 'trend',
  arrange_widgets: 'grid',
  remove_widget: 'grid',
  move_event: 'calendar',
  cancel_event: 'calendar',
};

/** A small card under a reply saying what the AI did, with Undo. */
function ActionCard({ action, onUndone }: { action: ActionResult & { undone?: boolean }; onUndone: () => void }) {
  const [busy, setBusy] = useState(false);
  const card = (
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
  if (!action.body || action.undone) return card;
  // A reply: the draft itself, to read before sending it from Gmail.
  return (
    <div className="draft-card">
      {card}
      <div className="draft-body">{action.body}</div>
      {action.url && (
        <button className="draft-open" onClick={() => window.hub.openExternal(action.url!)}>
          <Icon name="external" size={12} /> Open in Gmail to send
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
  /** Text highlighted in the browser, to ask about. */
  quote?: { text: string; title: string } | null;
  onQuoteUsed?: () => void;
}) {
  const { aiOn, messages, onMessages, onOpenSettings, ask, onAsked, panel = false, quote = null, onQuoteUsed } = props;
  const input = useRef<HTMLTextAreaElement>(null);
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
  // Speaking adds the words to whatever's already typed.
  const voice = useVoice((text) => {
    setDraft((d) => (d.trim() ? `${d.trimEnd()} ${text}` : text));
    requestAnimationFrame(() => input.current?.focus());
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** What it's looking up right now, while it works. */
  const [working, setWorking] = useState<(ToolStep & { running?: boolean })[]>([]);
  const end = useRef<HTMLDivElement>(null);
  // The answer as it's written (step-by-step chat streams it).
  const [streamed, setStreamed] = useState('');

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages, busy, working.length, streamed]);

  // The box grows with what you type, up to a point.
  useLayoutEffect(() => {
    const box = input.current;
    if (!box) return;
    box.style.height = 'auto';
    box.style.height = `${Math.min(box.scrollHeight, 200)}px`;
  }, [draft]);

  useEffect(() => {
    if (typeof window.hub.onChatDelta !== 'function') return;
    return window.hub.onChatDelta((delta) => setStreamed((t) => t + delta));
  }, []);

  // Listens all the time, so a step that arrives right away isn't missed.
  useEffect(() => {
    if (typeof window.hub.onChatStep !== 'function') return;
    return window.hub.onChatStep((step) =>
      setWorking((list) => {
        // A finished step replaces its "running" line.
        const at = step.running ? -1 : list.findIndex((s) => s.running && s.name === step.name && s.detail === step.detail);
        return at >= 0 ? list.map((s, k) => (k === at ? step : s)) : [...list, step];
      }),
    );
  }, []);

  // Highlighted text arrives: wait for the question about it.
  useEffect(() => {
    if (quote) input.current?.focus();
  }, [quote]);

  // The last thing they asked, for Retry and Edit.
  const lastUser = messages.map((m) => m.role).lastIndexOf('user');
  /** A fresh answer to their last message. */
  const retry = () => lastUser >= 0 && void run(messages.slice(0, lastUser + 1));
  /** Their last message back in the box to change and send again. */
  const edit = () => {
    if (lastUser < 0 || busy) return;
    setDraft(messages[lastUser].content);
    if (messages[lastUser].images?.length) setPictures(messages[lastUser].images!);
    onMessages(messages.slice(0, lastUser));
    requestAnimationFrame(() => input.current?.focus());
  };

  async function send(text: string) {
    const attached = pictures;
    const typed = text.trim() || (attached.length ? (attached.length === 1 ? 'What’s in this picture?' : 'What’s in these pictures?') : '');
    const quoted = quote ? `> ${quote.text.trim().replace(/\n+/g, '\n> ')}\n\n` : '';
    const content = quoted + (typed || (quote ? 'What does this mean?' : ''));
    if (!content || busy) return;
    if (quote) onQuoteUsed?.();
    const next: ChatTurn[] = [...messages, { role: 'user', content, ...(attached.length && { images: attached }) }];
    setDraft('');
    setPictures([]);
    await run(next);
  }

  /** Asks the AI about a conversation that ends with their message. */
  async function run(next: ChatTurn[]) {
    if (busy) return;
    onMessages(next);
    setWorking([]);
    setStreamed('');
    setBusy(true);
    setError(null);
    try {
      // Chat that can do things, when this version of Life Hub has it.
      if (typeof window.hub.chatAct === 'function') {
        const { reply, actions, steps } = await window.hub.chatAct(next);
        onMessages([...next, { role: 'assistant', content: reply, ...(actions.length && { actions }), ...(steps?.length && { steps }) }]);
      } else {
        const reply = await window.hub.chat(next);
        onMessages([...next, { role: 'assistant', content: reply }]);
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
      setWorking([]);
      setStreamed('');
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
      <section className={`chat-off ${panel ? 'is-panel' : 'card'}`}>
        <Spark size={34} />
        <h2 className="chat-hello">Life Hub AI</h2>
        <p className="muted">
          Ask about your day, look things up on the web, check your stocks, or have it add tasks and reminders. It's free: turn on a free Gemini key, or AI on
          this computer, in Settings.
        </p>
        <button className="button chat-on-button" onClick={onOpenSettings}>
          Turn on free AI
        </button>
      </section>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send(draft);
  };
  const live = working.filter((s) => s.running).pop() ?? null;
  const lastAi = messages.reduce((n, m, i) => (m.role === 'assistant' ? i : n), -1);

  return (
    <section
      className={`chat ${panel ? 'is-panel' : 'card'} ${dropping ? 'is-dropping' : ''}`}
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
            <Spark size={30} />
            <h2 className="chat-hello">{hello(new Date().getHours())}</h2>
            <p className="chat-hello-sub">Ask about your day, search the web, or tell me to add something.</p>
            <div className="chat-suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s.text} className="chat-suggestion" onClick={() => void send(s.text)}>
                  <Icon name={s.icon} size={14} />
                  {s.text}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="msg msg-user">
              {m.images && m.images.length > 0 && (
                <div className="bubble-pics bubble-pics-user">
                  {m.images.map((src, k) => (
                    <img key={k} src={src} alt="" />
                  ))}
                </div>
              )}
              <UserText text={m.content} />
              {i === lastUser && !busy && (
                <div className="msg-tools msg-tools-user">
                  <button className="msg-tool" onClick={edit} title="Edit and send again" aria-label="Edit">
                    <Icon name="edit" size={13} />
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div key={i} className={`msg msg-ai ${i === lastAi ? 'is-last' : ''}`}>
              {m.steps && m.steps.length > 0 && <Steps steps={m.steps} />}
              <Markdown text={m.content} />
              {m.actions?.map((a, j) => (
                <ActionCard
                  key={j}
                  action={a}
                  onUndone={() =>
                    onMessages(messages.map((t, k) => (k === i ? { ...t, actions: t.actions?.map((x, y) => (y === j ? { ...x, undone: true } : x)) } : t)))
                  }
                />
              ))}
              <div className="msg-tools">
                <CopyButton text={m.content} />
                {i === lastAi && !busy && (
                  <button className="msg-tool" onClick={retry} title="Try again" aria-label="Try again">
                    <Icon name="refresh" size={13} />
                  </button>
                )}
              </div>
            </div>
          ),
        )}
        {busy && (
          <div className="msg msg-ai is-working">
            {working.filter((s) => !s.running).length > 0 && (
              <ul className="working-done">
                {working
                  .filter((s) => !s.running)
                  .map((s, k) => (
                    <li key={k}>
                      <Icon name={s.ok ? 'check' : 'x'} size={11} /> {s.label}
                      {s.detail && <em> {s.detail}</em>}
                    </li>
                  ))}
              </ul>
            )}
            {streamed && <Markdown text={streamed} />}
            <div className={`working-now ${streamed && !live ? 'is-writing' : ''}`}>
              <Spark size={20} working />
              <span className="working-text">
                {streamed && !live ? null : live ? (
                  <>
                    {live.label}
                    {live.detail && <em> {live.detail}</em>}…
                  </>
                ) : working.length ? (
                  'Writing…'
                ) : (
                  'Thinking…'
                )}
              </span>
            </div>
          </div>
        )}
        {error && <p className="settings-error">{error}</p>}
        <div ref={end} />
      </div>
      <form className="composer" onSubmit={submit} onClick={(e) => e.target === e.currentTarget && input.current?.focus()}>
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
        {quote && (
          <div className="chat-quote">
            <span className="chat-quote-text">{quote.text}</span>
            <button type="button" onClick={onQuoteUsed} aria-label="Remove the highlighted text" title="Remove">
              <Icon name="x" size={11} />
            </button>
          </div>
        )}
        <VoiceBar voice={voice} />
        {voice.error && (
          <p className="voice-error" role="alert">
            {voice.error}
            <button type="button" onClick={voice.clearError} aria-label="Dismiss">
              <Icon name="x" size={11} />
            </button>
          </p>
        )}
        <textarea
          hidden={voice.phase === 'recording' || voice.phase === 'writing'}
          ref={input}
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter starts a new line.
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send(draft);
            }
          }}
          onPaste={(e) => {
            const files = imageFiles(e.clipboardData.files);
            if (!files.length) return;
            e.preventDefault();
            void addPictures(files);
          }}
          placeholder={quote ? 'Ask about what you highlighted…' : pictures.length ? 'Ask about the picture…' : messages.length ? 'Reply to Life Hub AI…' : 'How can I help you today?'}
          autoFocus={!panel}
        />
        <div className="composer-row">
          <button
            type="button"
            className="composer-btn"
            onClick={() => picker.current?.click()}
            disabled={busy || pictures.length >= MAX_PICTURES}
            aria-label="Add a picture"
            title="Add a picture (or paste one with Ctrl+V)"
          >
            <Icon name="plus" size={16} />
          </button>
          {typeof window.hub.transcribe === 'function' && <MicButton voice={voice} disabled={busy} />}
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
          <span className="composer-hint">{busy ? '' : 'Searches the web, your email and calendar'}</span>
          {busy && typeof window.hub.chatStop === 'function' ? (
            <button className="composer-send is-stop" type="button" onClick={() => void window.hub.chatStop?.()} aria-label="Stop" title="Stop">
              <span className="stop-square" />
            </button>
          ) : (
            <button className="composer-send" type="submit" disabled={busy || (!draft.trim() && !pictures.length && !quote)} aria-label="Send" title="Send (Enter)">
              <Icon name="arrow-up" size={16} />
            </button>
          )}
        </div>
      </form>
      <p className="chat-foot">Life Hub AI can make mistakes. Double-check anything important.</p>
    </section>
  );
}
