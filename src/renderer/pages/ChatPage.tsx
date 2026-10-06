import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { ActionResult } from '../../shared/actions';
import { explainChatError } from '../../shared/chatErrors';
import { dayLine, daySuggestions, type ChatDay } from '../../shared/chatSuggestions';
import { SIZE_COLUMNS, normalizeLayout, rowsFor, widgetTier, type PlacedWidget } from '../../shared/layout';
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

function hello(hour: number): string {
  if (hour < 5) return 'Up late?';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** What the AI is up to, shown by its orb. */
export type OrbState = 'idle' | 'thinking' | 'working' | 'done';

/**
 * Life Hub AI's presence: a purple orb. It breathes when idle, swirls while
 * it thinks, sends out a ring each time it uses a tool (`pulse` changes), and
 * settles when it's done. With reduced motion it holds still and the state
 * shows as a brighter core, a ring or a lit arc instead.
 */
export function Orb({ size = 18, state = 'idle', pulse = 0 }: { size?: number; state?: OrbState; pulse?: number }) {
  return (
    <span className="orb" data-state={state} style={{ width: size, height: size, ['--s' as string]: `${size}px` }} aria-hidden="true">
      <i className="orb-swirl" />
      <i className="orb-core" />
      <i className="orb-ring" key={pulse} />
    </span>
  );
}

type LiveStep = ToolStep & { running?: boolean };

/** A vertical rail of what it did, one node per step. Used live while it works and after. */
function Rail({ steps, children }: { steps: LiveStep[]; children?: ReactNode }) {
  return (
    <ol className="tl-rail">
      {steps.map((s, i) => (
        <li key={i} className={`tl-step ${s.running ? 'is-running' : s.ok ? 'is-done' : 'is-failed'}`}>
          <span className="tl-node">{s.running ? null : <Icon name={s.ok ? 'check' : 'x'} size={10} />}</span>
          <span className="tl-text">
            {s.label}
            {s.detail && <em> {s.detail}</em>}
            {!s.running && !s.ok && <em> (didn’t work)</em>}
          </span>
          {s.sources?.map((src, j) => {
            let host = src.title;
            try {
              host = new URL(src.url).hostname.replace(/^www\./, '');
            } catch {
              // Keep the title.
            }
            return (
              <a key={j} className="tl-source" href={src.url} target="_blank" rel="noreferrer" title={src.url}>
                <span className="tl-source-title">{src.title}</span>
                {host !== src.title && <span className="tl-source-host">{host}</span>}
              </a>
            );
          })}
        </li>
      ))}
      {children}
    </ol>
  );
}

/** "Looked up 3 things" above a reply: a row of nodes that opens into the full timeline. */
function Steps({ steps }: { steps: ToolStep[] }) {
  const [open, setOpen] = useState(false);
  const sources = steps.flatMap((s) => s.sources ?? []);
  const title = steps.length === 1 ? steps[0].label : `Looked up ${steps.length} things`;
  return (
    <div className={`tl ${open ? 'is-open' : ''}`}>
      <button type="button" className="tl-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="tl-dots" aria-hidden="true">
          {steps.map((s, i) => (
            <i key={i} className={s.ok ? '' : 'is-failed'} />
          ))}
        </span>
        <span>{title}</span>
        {sources.length > 0 && <span className="tl-count">{sources.length} sources</span>}
        <Icon name="chevron" size={12} className="tl-chevron" />
      </button>
      {open && <Rail steps={steps} />}
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
      aria-label={copied ? 'Copied' : 'Copy'}
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
  add_note: 'edit',
  tick_habit: 'check',
  remind: 'bell',
  set_holding: 'trend',
  remove_holding: 'trend',
  arrange_widgets: 'grid',
  remove_widget: 'grid',
  unsubscribe: 'mail',
  move_event: 'calendar',
  cancel_event: 'calendar',
};

type Result = ActionResult & { undone?: boolean };

/** "Team lunch · Friday 12:30 PM" into the thing and its date. */
function splitDetail(detail: string): [string, string] {
  const at = detail.lastIndexOf(' · ');
  return at > 0 ? [detail.slice(0, at), detail.slice(at + 3)] : [detail, ''];
}

/** A tiny map of a dashboard: each widget a block, lit when it needs you. */
function LayoutThumb({ layout, label }: { layout: PlacedWidget[]; label: string }) {
  return (
    <figure className="thumb">
      <div className="thumb-grid" role="img" aria-label={`${label}: ${layout.length} widgets`}>
        {layout.map((w) => (
          <i key={w.type} data-tier={widgetTier(w.type)} style={{ gridColumn: `span ${SIZE_COLUMNS[w.size]}`, gridRow: `span ${rowsFor(w.type, w.size, w.rows)}` }} />
        ))}
      </div>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

/** Before and after of a rearranged dashboard. Before comes from the Undo token; after is the page as it is now. */
function LayoutCompare({ undo }: { undo: string }) {
  const [now, setNow] = useState<PlacedWidget[] | null>(null);
  useEffect(() => {
    void window.hub.getLayout?.().then(setNow);
  }, []);
  let before: PlacedWidget[] | null = null;
  try {
    before = normalizeLayout(JSON.parse(undo.slice('layout:'.length)));
  } catch {
    before = null;
  }
  if (!before || !now) return null;
  return (
    <div className="thumbs">
      <LayoutThumb layout={before} label="Before" />
      <Icon name="next" size={14} className="thumbs-arrow" />
      <LayoutThumb layout={now} label="Now" />
    </div>
  );
}

/** Undo with its own confirmation, so it's clear what happened. */
function UndoButton({ run, label = 'Undo' }: { run: () => Promise<void>; label?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="result-undo"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void run().finally(() => setBusy(false));
      }}
    >
      {busy ? 'Undoing…' : label}
    </button>
  );
}

/** What the AI did, as a card you can check: the thing itself, its date, and Undo. */
function ResultCard({ action, onUndone }: { action: Result; onUndone: () => void }) {
  const [title, meta] = splitDetail(action.detail);
  const isEvent = action.type === 'add_event' || action.type === 'move_event' || action.type === 'cancel_event';
  const isLayout = action.type === 'arrange_widgets';
  const card = (
    <div className={`result result-${action.type} ${action.ok ? '' : 'is-failed'} ${action.undone ? 'is-undone' : ''}`}>
      <span className="result-icon">
        <Icon name={action.ok ? ACTION_ICON[action.type] : 'alert'} size={15} />
      </span>
      <div className="result-body">
        <span className="result-label">{action.undone ? 'Undone' : action.label}</span>
        <span className="result-title">{isLayout ? action.detail : title}</span>
        {meta && !isLayout && (
          <span className="result-meta">
            <Icon name={isEvent ? 'clock' : 'calendar'} size={11} /> {meta}
          </span>
        )}
        {isLayout && !action.undone && action.undo?.startsWith('layout:') && <LayoutCompare undo={action.undo} />}
      </div>
      {action.ok && action.undo && !action.undone && (
        <UndoButton
          run={async () => {
            await window.hub.undoAction(action.undo!);
            onUndone();
          }}
        />
      )}
    </div>
  );
  if (!action.body || action.undone) return card;
  // A reply or a new email: the draft itself, to read before sending it from Gmail.
  return (
    <div className="result-draft">
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

/** Many of the same thing at once (archive 14 emails): one card, one Undo. */
function BatchCard({ items, onUndone }: { items: { action: Result; index: number }[]; onUndone: (indices: number[]) => void }) {
  const [open, setOpen] = useState(false);
  const first = items[0].action;
  const live = items.filter((i) => !i.action.undone);
  return (
    <div className={`result result-batch ${live.length === 0 ? 'is-undone' : ''}`}>
      <span className="result-icon">
        <Icon name={ACTION_ICON[first.type]} size={15} />
      </span>
      <div className="result-body">
        <span className="result-label">{live.length === 0 ? 'Undone' : first.label}</span>
        <span className="result-title">{items.length} emails</span>
        <button type="button" className="result-more" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Hide the list' : 'Show the list'}
        </button>
        {open && (
          <ul className="result-list">
            {items.map((i) => (
              <li key={i.index} className={i.action.undone ? 'is-undone' : ''}>
                {i.action.detail}
              </li>
            ))}
          </ul>
        )}
      </div>
      {live.length > 0 && (
        <UndoButton
          label={`Undo all ${live.length}`}
          run={async () => {
            for (const i of live) await window.hub.undoAction(i.action.undo!);
            onUndone(live.map((i) => i.index));
          }}
        />
      )}
    </div>
  );
}

/** Cards for everything the AI did in one reply. Three or more of one kind of email change become one batch. */
function Results({ actions, onUndone }: { actions: Result[]; onUndone: (indices: number[]) => void }) {
  const groups: { items: { action: Result; index: number }[] }[] = [];
  actions.forEach((action, index) => {
    const last = groups[groups.length - 1];
    const joins = last && action.ok && !!action.undo && action.type === 'email' && last.items[0].action.type === 'email' && last.items[0].action.label === action.label && !action.body;
    if (joins) last.items.push({ action, index });
    else groups.push({ items: [{ action, index }] });
  });
  return (
    <div className="results">
      {groups.map((g, k) =>
        g.items.length >= 3 ? (
          <BatchCard key={k} items={g.items} onUndone={onUndone} />
        ) : (
          g.items.map((i) => <ResultCard key={i.index} action={i.action} onUndone={() => onUndone([i.index])} />)
        ),
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
  /** Today, for suggestions on the welcome screen. */
  day?: ChatDay | null;
  /** Text highlighted in the browser, to ask about. */
  quote?: { text: string; title: string } | null;
  onQuoteUsed?: () => void;
  /** Tells the page around it what the orb is doing. */
  onState?: (state: OrbState) => void;
  /** Bumped from outside to put the cursor in the box (Ctrl+/). */
  focusKey?: number;
}) {
  const { aiOn, messages, onMessages, onOpenSettings, ask, onAsked, day = null, quote = null, onQuoteUsed, onState, focusKey = 0 } = props;
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
  const [working, setWorking] = useState<LiveStep[]>([]);
  const end = useRef<HTMLDivElement>(null);
  // The answer as it's written (step-by-step chat streams it).
  const [streamed, setStreamed] = useState('');
  // Said out loud for screen readers: what it's doing, and what it did.
  const [announce, setAnnounce] = useState('');
  const [justDone, setJustDone] = useState(false);
  const doneTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(doneTimer.current), []);

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
  useEffect(() => {
    if (focusKey) input.current?.focus();
  }, [focusKey]);

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
    input.current?.focus();
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
    setAnnounce('Thinking…');
    try {
      // Chat that can do things, when this version of Life Hub has it.
      if (typeof window.hub.chatAct === 'function') {
        const { reply, actions, steps } = await window.hub.chatAct(next);
        onMessages([...next, { role: 'assistant', content: reply, ...(actions.length && { actions }), ...(steps?.length && { steps }) }]);
        const did = actions.filter((a) => a.ok).map((a) => `${a.label} ${a.detail}`);
        setAnnounce(`Done. ${did.length ? `${did.join('. ')}. ` : ''}${reply.replace(/[*_`#>]/g, '').slice(0, 160)}`);
      } else {
        const reply = await window.hub.chat(next);
        onMessages([...next, { role: 'assistant', content: reply }]);
        setAnnounce(`Done. ${reply.replace(/[*_`#>]/g, '').slice(0, 160)}`);
      }
      setJustDone(true);
      clearTimeout(doneTimer.current);
      doneTimer.current = setTimeout(() => setJustDone(false), 1600);
    } catch (err) {
      const problem = explainChatError(errorText(err));
      setError(`${problem.text}${problem.next ? ` ${problem.next}` : ''}`);
      setAnnounce(problem.text);
    } finally {
      setBusy(false);
      setWorking([]);
      setStreamed('');
      // The Send button went away while it worked; put the cursor back in the box.
      requestAnimationFrame(() => {
        const now = document.activeElement;
        if (!now || now === document.body || (now as HTMLElement).classList?.contains('composer-send')) input.current?.focus();
      });
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

  const live = working.filter((s) => s.running).pop() ?? null;
  const orb: OrbState = busy ? (live ? 'working' : 'thinking') : justDone ? 'done' : 'idle';
  useEffect(() => onState?.(orb), [orb]);
  // A ring goes out each time a step starts or ends.
  const pulse = working.length + working.filter((s) => !s.running).length;

  if (!aiOn || !window.hub.chat) {
    return (
      <section className="chat chat-off">
        <Orb size={48} />
        <h2 className="chat-hello">Life Hub AI</h2>
        <p className="muted">
          Ask about your day, look things up on the web, check your stocks, or have it add tasks and reminders. It's free: turn on a free Gemini key, or AI on
          this computer, in Settings.
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
  const lastAi = messages.reduce((n, m, i) => (m.role === 'assistant' ? i : n), -1);
  const suggestions = day ? daySuggestions(day) : daySuggestions({ now: Date.now(), events: [], emails: [], tasks: [] });

  return (
    <section
      className={`chat ${dropping ? 'is-dropping' : ''}`}
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
      {/* Spoken, not shown: what it's doing and what it did. The conversation itself isn't read out as it streams. */}
      <div className="sr-only" role="status" aria-live="polite">
        {announce}
      </div>
      <div className="chat-log" role="log" aria-label="Conversation" aria-live="off">
        {messages.length === 0 && (
          <div className="chat-empty">
            <Orb size={64} state={orb} pulse={pulse} />
            <h2 className="chat-hello">{hello(new Date().getHours())}</h2>
            <p className="chat-hello-sub">{day ? dayLine(day) : 'Ask about your day, search the web, or tell me to add something.'}</p>
            <div className="chat-suggestions">
              {suggestions.map((s) => (
                <button key={s.text} className="chat-suggestion" onClick={() => void send(s.prompt)}>
                  <span className="chat-suggestion-icon">
                    <Icon name={s.icon} size={14} />
                  </span>
                  <span className="chat-suggestion-text">{s.text}</span>
                  {s.hint && <span className="chat-suggestion-hint">{s.hint}</span>}
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
                    <img key={k} src={src} alt="A picture you sent" />
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
              {m.actions && m.actions.length > 0 && (
                <Results
                  actions={m.actions}
                  onUndone={(indices) =>
                    onMessages(messages.map((t, k) => (k === i ? { ...t, actions: t.actions?.map((x, y) => (indices.includes(y) ? { ...x, undone: true } : x)) } : t)))
                  }
                />
              )}
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
            <div className="tl is-live">
              <Rail steps={working}>
                <li className="tl-step is-tail">
                  <span className="tl-node tl-node-orb">
                    <Orb size={18} state={orb} pulse={pulse} />
                  </span>
                  <span className="tl-text">
                    {streamed && !live ? 'Writing' : live ? 'Working' : working.length ? 'Writing' : 'Thinking'}
                    {live ? '…' : '…'}
                  </span>
                </li>
              </Rail>
            </div>
            {streamed && <Markdown text={streamed} />}
          </div>
        )}
        {error && (
          <div className="chat-error" role="alert">
            <Icon name="alert" size={14} />
            <span>{error}</span>
            {lastUser >= 0 && (
              <button className="result-undo" onClick={retry}>
                Try again
              </button>
            )}
          </div>
        )}
        <div ref={end} />
      </div>
      <form className="composer" onSubmit={submit} onClick={(e) => e.target === e.currentTarget && input.current?.focus()}>
        {pictures.length > 0 && (
          <div className="chat-pics">
            {pictures.map((src, k) => (
              <span key={k} className="chat-pic">
                <img src={src} alt="A picture waiting to send" />
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
          aria-label="Message to Life Hub AI"
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
          placeholder={quote ? 'Ask about what you highlighted…' : pictures.length ? 'Ask about the picture…' : messages.length ? 'Say what’s next…' : 'Ask, or tell me what to do…'}
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
          <span className="composer-hint">{busy ? '' : 'Enter sends · Ctrl+/ from anywhere'}</span>
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
      <p className="chat-foot">Life Hub AI can make mistakes. Check anything important.</p>
    </section>
  );
}
