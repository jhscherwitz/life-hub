import { EventEmitter } from 'node:events';
import type { CaptureInput, DashboardSnapshot, SourceStatus } from '../src/shared/types';
import type { NoteStore } from './notes';
import type { Sources } from './sources';

function startOfDay(offset = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Pulls every source into one snapshot. A source that fails is reported in
 * `sources` and its section comes back empty, so one broken integration never
 * takes down the whole dashboard.
 */
export class Hub extends EventEmitter {
  private snapshot: DashboardSnapshot | null = null;
  private inflight: Promise<DashboardSnapshot> | null = null;

  constructor(
    private readonly sources: Sources,
    private readonly notes: NoteStore,
  ) {
    super();
  }

  current(): DashboardSnapshot | null {
    return this.snapshot;
  }

  async get(): Promise<DashboardSnapshot> {
    return this.snapshot ?? this.refresh();
  }

  refresh(): Promise<DashboardSnapshot> {
    if (!this.inflight) {
      this.inflight = this.load().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  async setTaskDone(id: string, done: boolean): Promise<void> {
    await this.sources.tasks.setDone(id, done);
    await this.refresh();
  }

  async capture(input: CaptureInput): Promise<void> {
    const text = input.text.trim();
    if (!text) return;
    if (input.kind === 'note') {
      this.notes.add(text);
    } else {
      await this.sources.tasks.addTask({ title: text });
    }
    await this.refresh();
  }

  private async load(): Promise<DashboardSnapshot> {
    const { calendar, email, tasks, weather, commute } = this.sources;
    const statuses: SourceStatus[] = [];

    async function attempt<T>(source: { name: string; kind: 'sample' | 'live' }, fn: () => Promise<T>, fallback: T): Promise<T> {
      try {
        const value = await fn();
        statuses.push({ name: source.name, kind: source.kind, ok: true });
        return value;
      } catch (err) {
        statuses.push({ name: source.name, kind: source.kind, ok: false, error: err instanceof Error ? err.message : String(err) });
        return fallback;
      }
    }

    const [events, emails, taskList, weatherNow] = await Promise.all([
      attempt(calendar, () => calendar.listEvents({ start: startOfDay(0), end: startOfDay(2) }), []),
      attempt(email, () => email.listInbox({ limit: 25 }), []),
      attempt(tasks, () => tasks.listTasks(), []),
      attempt(weather, () => weather.getWeather(), null),
    ]);
    const todaysEvents = events.filter((e) => new Date(e.start) < startOfDay(1));
    const commuteNow = await attempt(commute, () => commute.getCommute(todaysEvents), null);

    this.snapshot = {
      generatedAt: new Date().toISOString(),
      events,
      emails,
      tasks: taskList,
      weather: weatherNow,
      commute: commuteNow,
      notes: this.notes.list(),
      sources: statuses,
    };
    this.emit('snapshot', this.snapshot);
    return this.snapshot;
  }
}
