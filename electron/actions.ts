import { randomUUID } from 'node:crypto';
import type { ActionResult, ChatAction } from '../src/shared/actions';
import { dueValue, parseWhen, whenLabel } from '../src/shared/when';
import type { ExtrasStore } from './extras';
import type { HabitStore } from './habits';
import type { Hub } from './hub';
import type { ReminderStore } from './reminders';

export interface ActionDeps {
  hub: Pick<Hub, 'addTask' | 'removeTask' | 'addNote' | 'removeNote'>;
  extras: Pick<ExtrasStore, 'get' | 'setCountdowns'>;
  habits: Pick<HabitStore, 'get' | 'toggle'>;
  reminders: Pick<ReminderStore, 'add' | 'remove'>;
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
  }
}

/** Undoes one action from its undo token. */
export async function undoAction(token: string, deps: ActionDeps): Promise<void> {
  const [kind, ...rest] = String(token).split(':');
  const id = rest.join(':');
  if (!id) return;
  if (kind === 'task') await deps.hub.removeTask(id);
  else if (kind === 'note') await deps.hub.removeNote(id);
  else if (kind === 'reminder') deps.reminders.remove(id);
  else if (kind === 'countdown') deps.extras.setCountdowns(deps.extras.get().countdowns.filter((c) => c.id !== id));
  else if (kind === 'habit') {
    if (deps.habits.get().habits.find((h) => h.id === id)?.done) deps.habits.toggle(id);
  }
}
