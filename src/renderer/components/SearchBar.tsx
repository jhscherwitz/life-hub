import { useEffect, useMemo, useRef, useState } from 'react';
import { daysLabel, sortCountdowns } from '../../shared/extras';
import { WIDGETS, WIDGET_TYPES } from '../../shared/layout';
import { STATIONS } from '../../shared/media';
import { isCrypto, money, sharesText, signedPct } from '../../shared/portfolio';
import { KIND_LABEL, groupResults, mergeUnique, searchItems, type SearchItem, type SearchKind } from '../../shared/search';
import { formatTime, localIsoDate } from '../../shared/time';
import { dueValue, parseWhen, whenLabel } from '../../shared/when';
import type { CalendarEvent, DashboardSnapshot, EmailMessage } from '../../shared/types';
import type { Player } from '../player';
import { useExtras } from './extras';
import { useCanvas } from './GradesWidget';
import { usePortfolio } from './PortfolioWidget';
import { useReminders } from './RemindersWidget';
import { Icon, type IconName } from './Icon';
import { openLockedIn } from './LockedInCard';
import { useHabits } from './SkyCard';

export type SearchPage = 'today' | 'calendar' | 'inbox' | 'tasks' | 'chat';

export interface SearchActions {
  go(page: SearchPage): void;
  openSettings(): void;
  customize(): void;
  wrapUp(): void;
  refresh(): void;
  /** Opens Chat and asks the AI this. */
  ask(question: string): void;
}

const KIND_ICON: Record<SearchKind, IconName> = {
  action: 'bolt',
  page: 'grid',
  task: 'tasks',
  email: 'mail',
  event: 'calendar',
  note: 'info',
  countdown: 'timer',
  habit: 'sparkle',
  station: 'radio',
  widget: 'plus',
  course: 'tasks',
  reminder: 'bell',
  stock: 'trend',
};

interface Entry extends SearchItem {
  run(): void;
  /** What Enter does, shown at the right. */
  hint: string;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = localIsoDate();
  const day = localIsoDate(d);
  const date = day === today ? 'Today' : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  return `${date} · ${formatTime(iso)}`;
}

function eventEntry(e: CalendarEvent, actions: SearchActions): Entry {
  return {
    id: e.id,
    kind: 'event',
    title: e.title,
    subtitle: [dayLabel(e.start), e.location, e.calendar].filter(Boolean).join(' · '),
    run: () => (e.meetingUrl ? window.hub.openExternal(e.meetingUrl) : actions.go('calendar')),
    hint: e.meetingUrl ? 'Join' : 'Open',
  };
}

function emailEntry(m: EmailMessage, actions: SearchActions): Entry {
  return {
    id: m.id,
    kind: 'email',
    title: m.subject,
    subtitle: `${m.from.name} · ${m.snippet}`,
    keywords: m.from.email,
    run: () => (m.url ? window.hub.openExternal(m.url) : actions.go('inbox')),
    hint: m.url ? 'Open in Gmail' : 'Open',
  };
}

/** Everything Life Hub knows about, as search entries. */
function useEntries(snapshot: DashboardSnapshot, player: Player | undefined, actions: SearchActions, now: number): Entry[] {
  const { extras } = useExtras();
  const habits = useHabits(now);
  const canvas = useCanvas().data;
  const reminders = useReminders().list;
  const portfolio = usePortfolio().data;
  return useMemo(() => {
    const go = (page: SearchPage) => () => actions.go(page);
    const list: Entry[] = [
      { id: 'p-today', kind: 'page', title: 'Dashboard', keywords: 'home today widgets', run: go('today'), hint: 'Go' },
      { id: 'p-calendar', kind: 'page', title: 'Calendar', keywords: 'schedule day events meetings', run: go('calendar'), hint: 'Go' },
      { id: 'p-inbox', kind: 'page', title: 'Inbox', keywords: 'email mail gmail', run: go('inbox'), hint: 'Go' },
      { id: 'p-tasks', kind: 'page', title: 'Tasks', keywords: 'todo to-do list notes', run: go('tasks'), hint: 'Go' },
      { id: 'p-chat', kind: 'page', title: 'Life Hub AI', keywords: 'ai assistant ask talk chat', run: go('chat'), hint: 'Open' },
      {
        id: 'a-settings',
        kind: 'action',
        title: 'Settings',
        keywords: 'preferences google sign in ai gemini ollama background town weather morning startup',
        run: actions.openSettings,
        hint: 'Open',
      },
      {
        id: 'a-customize',
        kind: 'action',
        title: 'Customize dashboard',
        keywords: 'widgets layout edit add widget move resize',
        run: actions.customize,
        hint: 'Open',
      },
      { id: 'a-wrap', kind: 'action', title: 'Wrap up the day', keywords: 'evening end day review', run: actions.wrapUp, hint: 'Start' },
      { id: 'a-refresh', kind: 'action', title: 'Refresh', keywords: 'reload update sync', run: actions.refresh, hint: 'Run' },
      { id: 'a-focus', kind: 'action', title: 'Open LockedIn', keywords: 'pomodoro timer study focus', run: openLockedIn, hint: 'Open' },
    ];
    if (player) {
      list.push({
        id: 'a-radio',
        kind: 'action',
        title: player.playing ? 'Pause the radio' : 'Play the radio',
        keywords: 'music radio pause play stop',
        run: player.toggle,
        hint: player.playing ? 'Pause' : 'Play',
      });
      for (const s of STATIONS)
        list.push({
          id: s.id,
          kind: 'station',
          title: s.name,
          subtitle: `${s.freq.toFixed(1)} FM · ${s.vibe}`,
          keywords: 'radio music play',
          run: () => player.playStation(s.id),
          hint: 'Play',
        });
      for (const t of player.library?.tracks ?? [])
        list.push({
          id: `track-${t.id}`,
          kind: 'station',
          title: t.title,
          subtitle: t.artist || 'My music',
          keywords: 'song music',
          run: () => player.playTrack(t),
          hint: 'Play',
        });
    }

    for (const t of snapshot.tasks) {
      list.push({
        id: t.id,
        kind: 'task',
        title: t.title,
        subtitle: [
          t.done ? 'Done' : 'Open',
          t.due ? `due ${new Date(`${t.due.slice(0, 10)}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}` : '',
          t.project,
        ]
          .filter(Boolean)
          .join(' · '),
        run: () => (t.done ? actions.go('tasks') : void window.hub.setTaskDone(t.id, true)),
        hint: t.done ? 'Open' : 'Mark done',
      });
    }
    for (const e of snapshot.events) list.push(eventEntry(e, actions));
    for (const m of snapshot.emails) list.push(emailEntry(m, actions));
    for (const n of snapshot.notes) list.push({ id: n.id, kind: 'note', title: n.text, subtitle: 'Quick note', run: go('tasks'), hint: 'Open' });
    if (extras?.note.trim())
      list.push({
        id: 'sticky',
        kind: 'note',
        title: extras.note.trim().split('\n')[0],
        subtitle: 'Sticky note',
        keywords: extras.note,
        run: go('today'),
        hint: 'Open',
      });
    for (const c of sortCountdowns(extras?.countdowns ?? [], localIsoDate(new Date(now)))) {
      list.push({ id: c.id, kind: 'countdown', title: c.title, subtitle: daysLabel(c.days), run: go('today'), hint: 'Open' });
    }
    for (const h of habits.view?.habits ?? []) {
      list.push({
        id: h.id,
        kind: 'habit',
        title: h.title,
        subtitle: `${h.done ? 'Done today' : 'Not done yet'}${h.streak ? ` · ${h.streak} day streak` : ''}`,
        run: () => habits.run(window.hub.toggleHabit(h.id)),
        hint: h.done ? 'Untick' : 'Tick off',
      });
    }
    for (const c of canvas?.courses ?? []) {
      list.push({
        id: `course-${c.id}`,
        kind: 'course',
        title: c.name,
        subtitle: `${c.code}${c.score !== null ? ` · ${c.score}%${c.grade ? ` (${c.grade})` : ''}` : ''}`,
        keywords: 'grade class canvas',
        run: () => window.hub.openExternal(c.url),
        hint: 'Open grades',
      });
    }
    for (const a of canvas?.assignments ?? []) {
      list.push({
        id: a.id,
        kind: 'course',
        title: a.title,
        subtitle: `${a.courseName} · due ${dayLabel(a.due)}${a.submitted ? ' · turned in' : a.missing ? ' · missing' : ''}`,
        keywords: `canvas ${a.kind} assignment homework`,
        run: () => window.hub.openExternal(a.url),
        hint: 'Open in Canvas',
      });
    }
    for (const r of reminders ?? []) {
      if (r.done) continue;
      list.push({
        id: r.id,
        kind: 'reminder',
        title: r.text,
        subtitle: `Reminder · ${new Date(r.at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`,
        keywords: 'remind reminder',
        run: () => actions.go('today'),
        hint: 'Open',
      });
    }
    for (const h of portfolio?.holdings ?? []) {
      const q = portfolio?.quotes[h.symbol];
      const move = q ? signedPct(((q.price - q.previousClose) / (q.previousClose || 1)) * 100) : '';
      list.push({
        id: `stock-${h.symbol}`,
        kind: 'stock',
        title: q ? `${h.symbol} · ${q.name}` : h.symbol,
        subtitle: q
          ? `${portfolio!.hidden ? `${sharesText(h.shares)} shares` : `${money(q.price)} · ${sharesText(h.shares)} shares`} · ${move} today`
          : `${sharesText(h.shares)} shares`,
        keywords: 'stock stocks crypto portfolio robinhood invest',
        run: () => window.hub.openExternal(`https://robinhood.com/${isCrypto(h.symbol) ? 'crypto' : 'stocks'}/${encodeURIComponent(h.symbol)}`),
        hint: 'Open in Robinhood',
      });
    }
    for (const type of WIDGET_TYPES) {
      list.push({
        id: `w-${type}`,
        kind: 'widget',
        title: WIDGETS[type].title,
        subtitle: WIDGETS[type].description,
        keywords: 'widget add',
        run: actions.customize,
        hint: 'Customize',
      });
    }
    return list;
  }, [snapshot, player, actions, extras, habits, canvas, reminders, portfolio, now]);
}

/** Search everything: always at the top of the page. Ctrl+K (or /) jumps here. */
export function SearchBar({ snapshot, player, now, actions }: { snapshot: DashboardSnapshot; player?: Player; now: number; actions: SearchActions }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [live, setLive] = useState<Entry[]>([]);
  const [searching, setSearching] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const entries = useEntries(snapshot, player, actions, now);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  // Ctrl+K or / from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing)) {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, []);

  // The whole mailbox and a year of calendar, a moment after typing stops.
  useEffect(() => {
    const q = query.trim();
    setLive([]);
    if (q.length < 3 || typeof window.hub.search !== 'function') return;
    let alive = true;
    const timer = setTimeout(() => {
      setSearching(true);
      window.hub
        .search(q)
        .then(
          ({ emails, events }) =>
            alive && setLive([...emails.map((m) => emailEntry(m, actionsRef.current)), ...events.map((e) => eventEntry(e, actionsRef.current))]),
        )
        .catch(() => undefined)
        .finally(() => alive && setSearching(false));
    }, 350);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query]);

  const q = query.trim();
  const byKey = new Map([...entries, ...live].map((e) => [`${e.kind}:${e.id}`, e]));
  const found = q ? (mergeUnique(searchItems(entries, q), searchItems(live, q, 8)) as Entry[]).map((i) => byKey.get(`${i.kind}:${i.id}`)!) : [];
  const groups = groupResults(found) as { kind: SearchKind; items: Entry[] }[];
  const when = q ? parseWhen(q) : null;
  const extra: Entry[] = q
    ? [
        ...(when?.remind || (when?.time && typeof window.hub.addReminder === 'function')
          ? [
              {
                id: 'add-reminder',
                kind: 'action' as const,
                title: when.date ? `Remind me: “${when.title || q}” · ${whenLabel(dueValue(when)!)}` : `Remind me: “${when.title || q}” (add a time)`,
                run: () => void window.hub.addReminder(q).catch(() => actions.ask(q)),
                hint: 'Remind',
              },
            ]
          : []),
        {
          id: 'add-task',
          kind: 'action',
          title: when?.date ? `Add “${when.title || q}” · due ${whenLabel(dueValue(when)!)}` : `Add “${q}” as a task`,
          run: () => void window.hub.capture({ text: q, kind: 'task' }),
          hint: 'Add',
        },
        { id: 'add-note', kind: 'action', title: `Save “${q}” as a note`, run: () => void window.hub.capture({ text: q, kind: 'note' }), hint: 'Save' },
        { id: 'ask', kind: 'action', title: `Ask AI: “${q}”`, run: () => actions.ask(q), hint: window.hub.platform === 'darwin' ? '⌘↵' : 'Ctrl ↵' },
        {
          id: 'web',
          kind: 'action',
          title: `Search the web for “${q}”`,
          run: () => window.hub.openExternal(`https://www.google.com/search?q=${encodeURIComponent(q)}`),
          hint: 'Open',
        },
      ]
    : [];
  const flat = [...groups.flatMap((g) => g.items), ...extra];

  useEffect(() => setActive(0), [query]);

  const choose = (entry: Entry | undefined) => {
    if (!entry) return;
    entry.run();
    setOpen(false);
    setQuery('');
    input.current?.blur();
  };

  let index = -1;
  const row = (e: Entry) => {
    index++;
    const i = index;
    return (
      <li key={`${e.kind}:${e.id}`}>
        <button className={`search-row ${i === active ? 'is-active' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => choose(e)}>
          <span className={`search-icon kind-${e.kind}`}>
            <Icon
              name={
                e.id === 'web'
                  ? 'external'
                  : e.id === 'ask'
                    ? 'chat'
                    : e.id === 'add-task' || e.id === 'add-note'
                      ? 'plus'
                      : e.id === 'add-reminder'
                        ? 'bell'
                        : KIND_ICON[e.kind]
              }
              size={14}
            />
          </span>
          <span className="search-text">
            <span className="search-title">{e.title}</span>
            {e.subtitle && <span className="search-sub">{e.subtitle}</span>}
          </span>
          <span className="search-hint">{e.hint}</span>
        </button>
      </li>
    );
  };

  return (
    <div className={`search ${open ? 'is-open' : ''}`} ref={box}>
      <label className="search-box">
        <Icon name="search" size={15} />
        <input
          ref={input}
          value={query}
          placeholder="Search everything"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(flat.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && query.trim()) {
              // Ctrl+Enter skips the list and asks the AI right away.
              e.preventDefault();
              actions.ask(query.trim());
              setQuery('');
              setOpen(false);
              input.current?.blur();
            } else if (e.key === 'Enter') {
              e.preventDefault();
              choose(flat[active]);
            } else if (e.key === 'Escape') {
              setOpen(false);
              input.current?.blur();
            }
          }}
          aria-label="Search everything"
        />
        {searching ? <span className="search-spin" aria-label="Searching" /> : <kbd>{window.hub.platform === 'darwin' ? '⌘K' : 'Ctrl K'}</kbd>}
      </label>
      {open && (
        <div className="search-panel" role="listbox">
          {!q ? (
            <div className="search-empty">
              <p>Search tasks, email, your calendar, notes, countdowns, daily tasks, your stocks, the radio, widgets and settings.</p>
              <p className="muted small">Signed in to Google, it searches your whole mailbox and a year of calendar too.</p>
              <p className="muted small">Type a question and press {window.hub.platform === 'darwin' ? '⌘' : 'Ctrl'}+Enter to ask the AI straight away.</p>
            </div>
          ) : (
            <>
              {groups.map((g) => (
                <section key={g.kind}>
                  <h3>{KIND_LABEL[g.kind]}</h3>
                  <ul>{g.items.map(row)}</ul>
                </section>
              ))}
              {groups.length === 0 && !searching && <p className="search-none muted small">Nothing in Life Hub matches. Try one of these:</p>}
              <section>
                <h3>More</h3>
                <ul>{extra.map(row)}</ul>
              </section>
            </>
          )}
        </div>
      )}
    </div>
  );
}
