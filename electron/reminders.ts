import { randomUUID } from 'node:crypto';
import { dueReminders, normalizeReminders, toQueue, type Reminder } from '../src/shared/reminders';
import { JsonFile } from './smart/store';

const NTFY = 'https://ntfy.sh';
const TICK_MS = 20_000;

/**
 * Sends one message to your phone through ntfy.sh (free, no account). With
 * `at`, ntfy holds it and delivers it then, even if this computer is off.
 */
export async function sendToPhone(
  topic: string,
  text: string,
  at?: Date,
  look: { title?: string; tags?: string; priority?: string; click?: string } = {},
): Promise<void> {
  const headers: Record<string, string> = { Title: look.title ?? 'Life Hub', Tags: look.tags ?? 'alarm_clock', Priority: look.priority ?? 'high' };
  if (look.click && /^https:\/\//.test(look.click)) headers.Click = look.click;
  if (at && at.getTime() > Date.now() + 15_000) headers.At = String(Math.floor(at.getTime() / 1000));
  const res = await fetch(`${NTFY}/${encodeURIComponent(topic)}`, { method: 'POST', headers, body: text, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`ntfy answered with error ${res.status}. Try again in a minute.`);
}

/** Reminders, saved in the app data folder. */
export class ReminderStore {
  private readonly file: JsonFile<unknown>;

  constructor(filePath: string) {
    this.file = new JsonFile<unknown>(filePath, () => []);
  }

  list(): Reminder[] {
    return normalizeReminders(this.file.read());
  }

  private write(list: Reminder[]): Reminder[] {
    const clean = normalizeReminders(list);
    this.file.write(clean);
    return clean;
  }

  add(text: string, at: string): Reminder {
    const clean = text.trim().slice(0, 300);
    if (!clean) throw new Error('Say what to remind you about.');
    if (Number.isNaN(Date.parse(at))) throw new Error("That time didn't make sense. Try something like “6pm” or “friday 9am”.");
    const reminder: Reminder = { id: randomUUID(), text: clean, at: new Date(at).toISOString(), done: false };
    this.write([...this.list(), reminder]);
    return reminder;
  }

  remove(id: string): Reminder[] {
    return this.write(this.list().filter((r) => r.id !== id));
  }

  update(id: string, change: Partial<Reminder>): void {
    this.write(this.list().map((r) => (r.id === id ? { ...r, ...change } : r)));
  }

  /** Drops reminders that went off more than a day ago. */
  tidy(now: number): void {
    const list = this.list();
    const kept = list.filter((r) => !r.done || now - Date.parse(r.at) < 86_400_000);
    if (kept.length !== list.length) this.write(kept);
  }
}

/**
 * Every 20 seconds: shows reminders that are due on this computer, and hands
 * ones within three days to ntfy so they reach the phone on time.
 */
export class ReminderScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly store: ReminderStore,
    private readonly phoneTopic: () => string | null,
    private readonly notify: (reminder: Reminder) => void,
    private readonly changed: () => void,
  ) {}

  start(): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now = Date.now()): Promise<void> {
    let changed = false;
    const topic = this.phoneTopic();
    if (topic) {
      for (const r of toQueue(this.store.list(), now)) {
        try {
          await sendToPhone(topic, r.text, new Date(r.at));
          this.store.update(r.id, { queued: true });
          changed = true;
        } catch {
          // Offline or ntfy busy: try again next tick.
        }
      }
    }
    for (const r of dueReminders(this.store.list(), now)) {
      this.notify(r);
      this.store.update(r.id, { done: true });
      changed = true;
    }
    this.store.tidy(now);
    if (changed) this.changed();
  }
}
