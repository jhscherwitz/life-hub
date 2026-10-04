import { randomUUID } from 'node:crypto';
import type { ActionResult, ChatAction } from '../src/shared/actions';
import { cleanSymbol, money, sharesText } from '../src/shared/portfolio';
import { dueValue, parseWhen, whenLabel } from '../src/shared/when';
import type { ExtrasStore } from './extras';
import type { HabitStore } from './habits';
import type { PortfolioStore } from './portfolio';
import type { Hub } from './hub';
import type { ReminderStore } from './reminders';
import type { NewEvent } from './sources/types';
import { MAIL_UNDO, type CalendarEvent, type EmailMessage, type MailChange } from '../src/shared/types';
import { formatTime } from '../src/shared/time';

export interface ActionDeps {
  hub: Pick<Hub, 'addTask' | 'removeTask' | 'addNote' | 'removeNote'>;
  extras: Pick<ExtrasStore, 'get' | 'setCountdowns'>;
  habits: Pick<HabitStore, 'get' | 'toggle'>;
  reminders: Pick<ReminderStore, 'add' | 'remove'>;
  portfolio: Pick<PortfolioStore, 'add' | 'setShares' | 'holdings'>;
  /** Gmail, when signed in with permission to change email. */
  mail?: {
    canChange: () => boolean;
    change: (threadId: string, change: MailChange) => Promise<void>;
    find: (id: string) => EmailMessage | undefined;
  };
  /** Google Calendar, when signed in with permission to add events. */
  calendar?: {
    canAdd: () => boolean;
    add: (input: NewEvent) => Promise<CalendarEvent>;
    remove: (id: string) => Promise<void>;
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
    case 'add_countdown': {
      if (!date) throw new Error(`Countdowns need a day. Try “${action.title} on nov 12”.`);
      const id = randomUUID();
      const title = fromTitle.title || action.title;
      deps.extras.setCountdowns([...deps.extras.get().countdowns, { id, title, date }]);
      return { type: action.type, label: 'Countdown', detail: `${title} · ${whenLabel(date, now)}`, ok: true, undo: `countdown:${id}` };
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
  }
}

/** Undoes one action from its undo token. */
export async function undoAction(token: string, deps: ActionDeps): Promise<void> {
  const [kind, ...rest] = String(token).split(':');
  const id = rest.join(':');
  if (!id) return;
  if (kind === 'task') await deps.hub.removeTask(id);
  else if (kind === 'event') await deps.calendar?.remove(id);
  else if (kind === 'mail') {
    const [change, ...thread] = id.split(':');
    await deps.mail?.change(thread.join(':'), change as MailChange);
  }
  else if (kind === 'note') await deps.hub.removeNote(id);
  else if (kind === 'reminder') deps.reminders.remove(id);
  else if (kind === 'countdown') deps.extras.setCountdowns(deps.extras.get().countdowns.filter((c) => c.id !== id));
  else if (kind === 'holding') {
    const [symbol, shares] = id.split(':');
    deps.portfolio.setShares(symbol, Number(shares) || 0);
  } else if (kind === 'habit') {
    if (deps.habits.get().habits.find((h) => h.id === id)?.done) deps.habits.toggle(id);
  }
}
