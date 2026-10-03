// Reminders: a note to yourself at a time. They pop up on this computer, and
// on your phone too if phone reminders are set up (free, through ntfy).

export interface Reminder {
  id: string;
  text: string;
  /** ISO time it's due. */
  at: string;
  /** Shown on this computer already. */
  done: boolean;
  /** Handed to ntfy to deliver to the phone at the right time. */
  queued?: boolean;
}

export const MAX_REMINDERS = 100;
/** ntfy.sh holds a scheduled message for up to three days. */
export const PHONE_QUEUE_MS = 3 * 86_400_000;

export function normalizeReminders(value: unknown): Reminder[] {
  if (!Array.isArray(value)) return [];
  const out: Reminder[] = [];
  for (const item of value) {
    const r = item as Partial<Reminder> | null;
    if (!r || typeof r.id !== 'string' || typeof r.text !== 'string' || typeof r.at !== 'string' || Number.isNaN(Date.parse(r.at))) continue;
    out.push({ id: r.id, text: r.text.slice(0, 300), at: r.at, done: Boolean(r.done), ...(r.queued && { queued: true }) });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at)).slice(-MAX_REMINDERS);
}

/** Reminders whose time has come and that haven't been shown yet. */
export function dueReminders(list: Reminder[], now: number): Reminder[] {
  return list.filter((r) => !r.done && Date.parse(r.at) <= now);
}

/** Reminders that should be handed to ntfy now: not yet sent, and within its three-day window. */
export function toQueue(list: Reminder[], now: number): Reminder[] {
  return list.filter((r) => !r.done && !r.queued && Date.parse(r.at) - now <= PHONE_QUEUE_MS);
}

/** A phone topic: long and random, so nobody can guess it and read your reminders. */
export function newPhoneTopic(random: () => number = Math.random): string {
  const letters = 'abcdefghijkmnpqrstuvwxyz23456789';
  let s = 'lifehub-';
  for (let i = 0; i < 18; i++) s += letters[Math.floor(random() * letters.length)];
  return s;
}
