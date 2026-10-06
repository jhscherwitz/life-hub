import { randomUUID } from 'node:crypto';
import { newGrocery } from '../src/shared/extras';
import { EMAIL_ADDRESS, type ActionResult, type ChatAction } from '../src/shared/actions';
import { cleanSymbol, money, sharesText } from '../src/shared/portfolio';
import { dueValue, parseWhen, whenLabel } from '../src/shared/when';
import type { ExtrasStore } from './extras';
import type { HabitStore } from './habits';
import type { PortfolioStore } from './portfolio';
import type { Hub } from './hub';
import type { ReminderStore } from './reminders';
import type { NewEvent } from './sources/types';
import type { Prefs } from './smart/prefs';
import { PILE_WORDS } from '../src/shared/inbox';
import { MAIL_UNDO, type CalendarEvent, type EmailMessage, type MailChange, type SavedDraft } from '../src/shared/types';
import { formatTime } from '../src/shared/time';

import { arrangeLayout, findWidgetType, WIDGETS, type PlacedWidget } from '../src/shared/layout';

export interface ActionDeps {
  hub: Pick<Hub, 'addTask' | 'removeTask' | 'addNote' | 'removeNote'>;
  extras: Pick<ExtrasStore, 'get' | 'setCountdowns' | 'setGroceries'>;
  habits: Pick<HabitStore, 'get' | 'toggle'>;
  reminders: Pick<ReminderStore, 'add' | 'remove'>;
  portfolio: Pick<PortfolioStore, 'add' | 'setShares' | 'holdings'>;
  /** Writing replies as Gmail drafts (never sent). */
  drafts?: {
    reply: (emailId: string, instructions: string) => Promise<SavedDraft>;
    /** A new email to an address, saved as a draft. */
    compose: (to: string, instructions: string, subjectHint?: string) => Promise<{ url: string; id?: string; subject: string; body: string }>;
    remove: (id: string) => Promise<void>;
    find: (id: string) => EmailMessage | undefined;
  };
  /** Your sorting rules and the things the AI remembers. */
  /** The dashboard's widgets. */
  layout?: { get: () => PlacedWidget[]; set: (layout: PlacedWidget[]) => void };
  prefs?: Pick<Prefs, 'addRule' | 'removeRule' | 'rules' | 'remember' | 'forget' | 'memories'>;
  /** Gmail, when signed in with permission to change email. */
  mail?: {
    canChange: () => boolean;
    change: (threadId: string, change: MailChange) => Promise<void>;
    unsubscribe?: (id: string) => Promise<{ how: 'done' | 'opened' | 'gmail'; from: string }>;
    find: (id: string) => EmailMessage | undefined;
  };
  /** Google Calendar, when signed in with permission to add events. */
  calendar?: {
    canAdd: () => boolean;
    add: (input: NewEvent) => Promise<CalendarEvent>;
    remove: (id: string) => Promise<void>;
    /** Finds an event you can change, by its ref or its name. */
    find?: (nameOrRef: string) => Promise<CalendarEvent | null>;
    move?: (ref: string, to: { date: string; time?: string; minutes?: number }) => Promise<{ before: unknown; event: CalendarEvent }>;
    setTimes?: (ref: string, times: unknown) => Promise<void>;
    cancel?: (ref: string) => Promise<{ calendarId: string; copy: Record<string, unknown>; title: string }>;
    restore?: (calendarId: string, copy: Record<string, unknown>) => Promise<void>;
  };
}

function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
}

/** Does what Chat asked, one action at a time. One failing doesn't stop the rest. */
export async function runActions(actions: ChatAction[], deps: ActionDeps, now = new Date()): Promise<ActionResult[]> {
  const results: ActionResult[] = [];
  for (const action of actions) {
    try {
      results.push(await runOne(action, deps, now));
    } catch (err) {
      results.push({ type: action.type, label: "Couldn't do that", detail: err instanceof Error ? err.message : String(err), ok: false });
    }
  }
  return results;
}

async function runOne(action: ChatAction, deps: ActionDeps, now: Date): Promise<ActionResult> {
  const when = parseWhen(action.when ?? '', now);
  const fromTitle = parseWhen(action.title, now);
  const date = when.date ?? fromTitle.date;
  const time = when.time ?? fromTitle.time;
  const due = dueValue({ date, time });

  switch (action.type) {
    case 'add_task': {
      const task = await deps.hub.addTask(action.title, due);
      if (!task) throw new Error('The task was empty.');
      return {
        type: action.type,
        label: 'Added task',
        detail: task.due ? `${task.title} · ${whenLabel(task.due, now)}` : task.title,
        ok: true,
        undo: `task:${task.id}`,
      };
    }
    case 'add_event': {
      if (!deps.calendar) throw new Error('Connect your Google account in Settings to add things to your calendar.');
      if (!deps.calendar.canAdd()) throw new Error('Life Hub needs permission to add to your calendar. Open Settings, sign out of Google, and sign in again.');
      if (!date) throw new Error(`Calendar events need a day. Try “${action.title} saturday 7pm”.`);
      const title = fromTitle.title || action.title;
      const event = await deps.calendar.add({ title, date, time, minutes: action.minutes, location: action.place });
      const when = event.allDay ? whenLabel(date, now) : `${whenLabel(dueValue({ date, time })!, now)}–${formatTime(event.end)}`;
      return { type: action.type, label: 'Added to calendar', detail: `${title} · ${when}`, ok: true, undo: `event:${event.id}` };
    }
    case 'unsubscribe': {
      if (!deps.mail?.unsubscribe) throw new Error('Connect your Google account in Settings first.');
      const { how, from } = await deps.mail.unsubscribe(action.title);
      const detail = how === 'done' ? from : how === 'opened' ? `${from} · finish on the page that opened` : `${from} · use Unsubscribe in Gmail`;
      return { type: action.type, label: how === 'done' ? 'Unsubscribed' : 'Unsubscribe page opened', detail, ok: true };
    }
    case 'move_event': {
      const cal = deps.calendar;
      if (!cal?.find || !cal.move) throw new Error('Connect your Google account in Settings to change your calendar.');
      if (!cal.canAdd()) throw new Error('Life Hub needs permission to change your calendar. Open Settings, sign out of Google, and sign in again.');
      if (!date) throw new Error(`Say when to move it to, like “${action.title} to friday 3pm”.`);
      const found = await cal.find(action.title);
      if (!found?.ref) throw new Error(`Couldn't find “${action.title}” on a calendar you can change.`);
      const { before, event } = await cal.move(found.ref, { date, time, minutes: action.minutes });
      const when = event.allDay ? whenLabel(date, now) : `${whenLabel(dueValue({ date, time })!, now)}–${formatTime(event.end)}`;
      return { type: action.type, label: 'Moved', detail: `${found.title} · ${when}`, ok: true, undo: `eventmove:${found.ref}|${JSON.stringify(before)}` };
    }
    case 'cancel_event': {
      const cal = deps.calendar;
      if (!cal?.find || !cal.cancel) throw new Error('Connect your Google account in Settings to change your calendar.');
      if (!cal.canAdd()) throw new Error('Life Hub needs permission to change your calendar. Open Settings, sign out of Google, and sign in again.');
      const found = await cal.find(action.title);
      if (!found?.ref) throw new Error(`Couldn't find “${action.title}” on a calendar you can change.`);
      const gone = await cal.cancel(found.ref);
      const when = found.allDay ? whenLabel(found.start.slice(0, 10), now) : whenLabel(found.start, now);
      return { type: action.type, label: 'Cancelled', detail: `${found.title} · ${when}`, ok: true, undo: `eventback:${JSON.stringify({ calendarId: gone.calendarId, copy: gone.copy })}` };
    }
    case 'email': {
      if (!deps.mail) throw new Error('Connect your Google account in Settings so the AI can change your email.');
      if (!deps.mail.canChange()) throw new Error('Life Hub needs permission to change your email. Open Settings, sign out of Google, and sign in again.');
      const change = action.change;
      if (!change) throw new Error('Say what to do with the email: archive, delete, star or mark read.');
      const id = action.title.replace(/^\[?(id|thread)\s*/i, '').replace(/\]$/, '').trim();
      const email = deps.mail.find(id);
      await deps.mail.change(email?.threadId ?? id, change);
      const LABEL: Record<MailChange, string> = {
        archive: 'Archived',
        unarchive: 'Moved to inbox',
        trash: 'Deleted',
        untrash: 'Restored',
        star: 'Starred',
        unstar: 'Unstarred',
        read: 'Marked read',
        unread: 'Marked unread',
      };
      const what = email ? `${email.from.name || email.from.email} · ${email.subject}` : 'an email';
      return { type: action.type, label: LABEL[change], detail: what, ok: true, undo: `mail:${MAIL_UNDO[change]}:${email?.threadId ?? id}` };
    }
    case 'new_email': {
      if (!deps.drafts) throw new Error('Connect your Google account in Settings so the AI can write emails.');
      const to = action.title.replace(/^mailto:/i, '').trim();
      if (!EMAIL_ADDRESS.test(to)) throw new Error(`“${action.title}” isn't an email address.`);
      if (!action.text) throw new Error('Say what the email should say.');
      const draft = await deps.drafts.compose(to, action.text, action.subject);
      return {
        type: action.type,
        label: 'Draft saved in Gmail',
        detail: `To ${to} · ${draft.subject}`,
        ok: true,
        body: draft.body,
        url: draft.url,
        ...(draft.id && { undo: `draft:${draft.id}` }),
      };
    }
    case 'reply': {
      if (!deps.drafts) throw new Error('Connect your Google account in Settings so the AI can write replies.');
      const id = action.title.replace(/^\[?(id|thread)\s*/i, '').replace(/\]$/, '').trim();
      // An address, not an email to answer: write a new email instead.
      if (EMAIL_ADDRESS.test(id) && !deps.drafts.find(id)) return runOne({ ...action, type: 'new_email', title: id }, deps, now);
      const email = deps.drafts.find(id);
      const draft = await deps.drafts.reply(email?.id ?? id, action.text ?? '');
      const who = email ? email.from.name || email.from.email : 'them';
      return {
        type: action.type,
        label: draft.savedToGmail ? 'Draft saved in Gmail' : 'Draft written',
        detail: `Reply to ${who}${email?.subject ? ` · ${email.subject}` : ''}`,
        ok: true,
        body: draft.body,
        ...(draft.url && { url: draft.url }),
        ...(draft.id && { undo: `draft:${draft.id}` }),
      };
    }
    case 'mail_rule': {
      if (!deps.prefs) throw new Error("Rules can't be saved here.");
      const rule = deps.prefs.addRule(action.title, action.pile ?? 'keep');
      return { type: action.type, label: PILE_WORDS[rule.pile], detail: rule.match, ok: true, undo: `rule:${rule.id}` };
    }
    case 'remove_rule': {
      const want = fold(action.title);
      const rule = deps.prefs?.rules().find((r) => fold(r.match) === want) ?? deps.prefs?.rules().find((r) => fold(r.match).includes(want) || want.includes(fold(r.match)));
      if (!rule) throw new Error(`There's no rule for “${action.title}”.`);
      deps.prefs!.removeRule(rule.id);
      return { type: action.type, label: 'Removed rule', detail: `${PILE_WORDS[rule.pile]} “${rule.match}”`, ok: true };
    }
    case 'remember': {
      if (!deps.prefs) throw new Error("Memories can't be saved here.");
      const memory = deps.prefs.remember(action.title);
      return { type: action.type, label: 'Remembered', detail: memory.text, ok: true, undo: `memory:${memory.id}` };
    }
    case 'forget': {
      const want = fold(action.title);
      const memory = deps.prefs?.memories().find((m) => fold(m.text).includes(want) || want.includes(fold(m.text)));
      if (!memory) throw new Error(`Nothing remembered about “${action.title}”.`);
      deps.prefs!.forget(memory.id);
      return { type: action.type, label: 'Forgot', detail: memory.text, ok: true };
    }
    case 'add_countdown': {
      if (!date) throw new Error(`Countdowns need a day. Try “${action.title} on nov 12”.`);
      const id = randomUUID();
      const title = fromTitle.title || action.title;
      deps.extras.setCountdowns([...deps.extras.get().countdowns, { id, title, date }]);
      return { type: action.type, label: 'Countdown', detail: `${title} · ${whenLabel(date, now)}`, ok: true, undo: `countdown:${id}` };
    }
    case 'add_grocery': {
      const id = randomUUID();
      const item = newGrocery(action.title, id);
      if (!item) throw new Error('Say what to put on the grocery list.');
      const list = deps.extras.get().groceries;
      const same = list.find((g) => !g.done && g.name.toLowerCase() === item.name.toLowerCase());
      if (same) return { type: action.type, label: 'Already on the list', detail: same.qty ? `${same.qty} ${same.name}` : same.name, ok: true };
      deps.extras.setGroceries([...list, item]);
      return { type: action.type, label: 'Grocery list', detail: item.qty ? `${item.qty} ${item.name}` : item.name, ok: true, undo: `grocery:${id}` };
    }
    case 'add_note': {
      const note = await deps.hub.addNote(action.title);
      if (!note) throw new Error('The note was empty.');
      return { type: action.type, label: 'Saved note', detail: note.text, ok: true, undo: `note:${note.id}` };
    }
    case 'remind': {
      if (!date) throw new Error(`Reminders need a time. Try “remind me to ${action.title} at 6pm”.`);
      const [y, m, d] = date.split('-').map(Number);
      const [h, min] = (time ?? '09:00').split(':').map(Number);
      const at = new Date(y, m - 1, d, h, min);
      if (at.getTime() < now.getTime() - 60_000) throw new Error('That time has already passed.');
      const text = fromTitle.title || action.title;
      const reminder = deps.reminders.add(text, at.toISOString());
      return {
        type: action.type,
        label: 'Reminder',
        detail: `${text} · ${whenLabel(dueValue({ date, time: time ?? '09:00' })!, now)}`,
        ok: true,
        undo: `reminder:${reminder.id}`,
      };
    }
    case 'tick_habit': {
      const want = fold(action.title);
      const habits = deps.habits.get().habits;
      const habit = habits.find((h) => fold(h.title) === want) ?? habits.find((h) => fold(h.title).includes(want) || want.includes(fold(h.title)));
      if (!habit) throw new Error(`There's no daily task called “${action.title}”.`);
      if (habit.done) return { type: action.type, label: 'Already done', detail: habit.title, ok: true };
      deps.habits.toggle(habit.id);
      return { type: action.type, label: 'Ticked off', detail: habit.title, ok: true, undo: `habit:${habit.id}` };
    }
    case 'set_holding': {
      const symbol = cleanSymbol(action.title);
      if (!symbol) throw new Error(`“${action.title}” isn't a ticker.`);
      if (action.shares === undefined || action.shares < 0) throw new Error(`How many shares of ${symbol} do you own?`);
      const before = deps.portfolio.holdings().find((h) => h.symbol === symbol)?.shares ?? 0;
      const undo = `holding:${symbol}:${before}`;
      if (action.shares === 0) {
        if (!before) throw new Error(`${symbol} isn't in your portfolio.`);
        deps.portfolio.setShares(symbol, 0);
        return { type: action.type, label: 'Removed stock', detail: symbol, ok: true, undo };
      }
      const data = await deps.portfolio.add(symbol, action.shares);
      const q = data.quotes[symbol];
      return {
        type: action.type,
        label: before ? 'Updated stock' : 'Added stock',
        detail: `${symbol} · ${sharesText(action.shares)} shares${q ? ` · ${money(q.price * action.shares)}` : ''}`,
        ok: true,
        undo,
      };
    }
    case 'remove_holding': {
      const symbol = cleanSymbol(action.title);
      const before = deps.portfolio.holdings().find((h) => h.symbol === symbol)?.shares;
      if (!before) throw new Error(`${symbol || action.title} isn't in your portfolio.`);
      deps.portfolio.setShares(symbol, 0);
      return { type: action.type, label: 'Removed stock', detail: symbol, ok: true, undo: `holding:${symbol}:${before}` };
    }
    case 'arrange_widgets': {
      if (!deps.layout) throw new Error("The dashboard can't be changed from here.");
      const before = deps.layout.get();
      const { layout, missing } = arrangeLayout(before, action.title.split(/,|\n|;/));
      if (missing.length && layout.length === before.length && layout.every((w, i) => w.type === before[i].type))
        throw new Error(`There's no widget called ${missing.map((m) => `“${m}”`).join(', ')}.`);
      deps.layout.set(layout);
      return {
        type: action.type,
        label: 'Rearranged dashboard',
        detail: layout.slice(0, 8).map((w) => WIDGETS[w.type].title).join(' → ') + (layout.length > 8 ? ' …' : ''),
        ok: true,
        undo: `layout:${JSON.stringify(before)}`,
      };
    }
    case 'remove_widget': {
      if (!deps.layout) throw new Error("The dashboard can't be changed from here.");
      const type = findWidgetType(action.title);
      const before = deps.layout.get();
      if (!type || !before.some((w) => w.type === type)) throw new Error(`There's no “${action.title}” widget on your dashboard.`);
      deps.layout.set(before.filter((w) => w.type !== type));
      return { type: action.type, label: 'Removed widget', detail: WIDGETS[type].title, ok: true, undo: `layout:${JSON.stringify(before)}` };
    }
  }
}

/** Undoes one action from its undo token. */
export async function undoAction(token: string, deps: ActionDeps): Promise<void> {
  const [kind, ...rest] = String(token).split(':');
  const id = rest.join(':');
  if (!id) return;
  if (kind === 'task') await deps.hub.removeTask(id);
  else if (kind === 'event') await deps.calendar?.remove(id);
  else if (kind === 'rule') deps.prefs?.removeRule(id);
  else if (kind === 'draft') await deps.drafts?.remove(id);
  else if (kind === 'memory') deps.prefs?.forget(id);
  else if (kind === 'mail') {
    const [change, ...thread] = id.split(':');
    await deps.mail?.change(thread.join(':'), change as MailChange);
  }
  else if (kind === 'note') await deps.hub.removeNote(id);
  else if (kind === 'reminder') deps.reminders.remove(id);
  else if (kind === 'countdown') deps.extras.setCountdowns(deps.extras.get().countdowns.filter((c) => c.id !== id));
  else if (kind === 'grocery') deps.extras.setGroceries(deps.extras.get().groceries.filter((g) => g.id !== id));
  else if (kind === 'holding') {
    const [symbol, shares] = id.split(':');
    deps.portfolio.setShares(symbol, Number(shares) || 0);
  } else if (kind === 'eventmove') {
    // ref is "calendarId|eventId", then "|" and where it was.
    const [calId, eventId, ...times] = id.split('|');
    try {
      await deps.calendar?.setTimes?.(`${calId}|${eventId}`, JSON.parse(times.join('|')));
    } catch {
      // A broken token: leave it.
    }
  } else if (kind === 'eventback') {
    try {
      const { calendarId, copy } = JSON.parse(id) as { calendarId: string; copy: Record<string, unknown> };
      await deps.calendar?.restore?.(calendarId, copy);
    } catch {
      // A broken token: leave it.
    }
  } else if (kind === 'layout') {
    try {
      deps.layout?.set(JSON.parse(id) as PlacedWidget[]);
    } catch {
      // A broken token: leave the dashboard as it is.
    }
  } else if (kind === 'habit') {
    if (deps.habits.get().habits.find((h) => h.id === id)?.done) deps.habits.toggle(id);
  }
}
