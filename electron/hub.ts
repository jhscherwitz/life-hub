import { EventEmitter } from 'node:events';
import type { Briefing, CalendarEvent, EmailMessage, CaptureInput, DashboardSnapshot, InboxSummary, SavedDraft, SourceStatus, WrapUp, WrapUpPreview } from '../src/shared/types';
import type { NoteStore } from './notes';
import type { ChatMessage } from './ai/types';
import type { SmartLayer } from './smart';
import type { DayContext } from './smart/context';
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
 * takes down the whole dashboard. The smart layer then triages the inbox and
 * adds the briefing and wrap-up.
 */
export class Hub extends EventEmitter {
  private snapshot: DashboardSnapshot | null = null;
  private inflight: Promise<DashboardSnapshot> | null = null;
  private lastContext: DayContext | null = null;

  constructor(
    private sources: Sources,
    private readonly notes: NoteStore,
    private readonly smart: SmartLayer,
    /** Whether Gmail drafts can be saved (signed in with the draft permission). */
    private readonly canSaveDrafts: () => boolean,
  ) {
    super();
  }

  /** Swap in new sources (after signing in, or changing settings) and reload. */
  setSources(sources: Sources): Promise<DashboardSnapshot> {
    this.sources = sources;
    // Wait for any load that started with the old sources, then load again.
    return (this.inflight ?? Promise.resolve()).catch(() => undefined).then(() => this.refresh());
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

  async addTask(title: string): Promise<void> {
    const text = title.trim();
    if (!text) return;
    await this.sources.tasks.addTask({ title: text });
    await this.refresh();
  }

  async removeTask(id: string): Promise<void> {
    await this.sources.tasks.removeTask(id);
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

  async rewriteBriefing(): Promise<void> {
    if (!this.lastContext) await this.refresh();
    const briefing = await this.smart.rewriteBriefing(this.lastContext!, this.sourcesKey());
    this.showBriefing(briefing);
  }

  /**
   * The morning update: reload every source, then wait for today's briefing.
   * If the AI already wrote one earlier today (Hub was open before the update
   * time), it writes a fresh one so the briefing reflects the morning's data.
   */
  async morningUpdate(): Promise<DashboardSnapshot> {
    const snapshot = await this.refresh();
    if (snapshot.briefing.writing) {
      await this.smart.briefingSettled();
    } else if (snapshot.briefing.writtenBy === 'ai') {
      await this.rewriteBriefing();
    }
    return this.snapshot ?? snapshot;
  }

  /**
   * Searches past what the dashboard has loaded: the whole mailbox and about a
   * year of calendar. A source that fails or can't search adds nothing.
   */
  async search(query: string): Promise<{ emails: EmailMessage[]; events: CalendarEvent[] }> {
    const q = query.trim().slice(0, 200);
    if (q.length < 2) return { emails: [], events: [] };
    const { email, calendar } = this.sources;
    const [emails, events] = await Promise.allSettled([email.search ? email.search(q, 8) : [], calendar.search ? calendar.search(q, 6) : []]);
    return { emails: emails.status === 'fulfilled' ? emails.value : [], events: events.status === 'fulfilled' ? events.value : [] };
  }

  async draftReply(emailId: string): Promise<SavedDraft> {
    const snapshot = await this.get();
    const email = snapshot.emails.find((m) => m.id === emailId);
    if (!email) throw new Error('That email is no longer in your inbox. Click Refresh.');
    if (this.sources.email.kind === 'live' && !this.canSaveDrafts()) {
      throw new Error('Life Hub needs your permission to save drafts. Open Settings, click Sign out, then Sign in with Google and tick every box.');
    }
    const draft = await this.smart.draftReply(email, this.sources.email, snapshot.events);
    if (this.snapshot) {
      this.snapshot = { ...this.snapshot, emails: this.snapshot.emails.map((m) => (m.id === emailId ? { ...m, draft } : m)) };
      this.emit('snapshot', this.snapshot);
    }
    return draft;
  }

  async summarizeInbox(): Promise<InboxSummary> {
    const snapshot = await this.get();
    return this.smart.summarizeInbox(snapshot.emails);
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    if (!this.lastContext) await this.get();
    return this.smart.chat(this.lastContext, messages);
  }

  async previewWrapUp(): Promise<WrapUpPreview> {
    return this.smart.previewWrapUp(await this.refresh());
  }

  async finishWrapUp(input: { carryOver: string[]; note: string }): Promise<WrapUp> {
    const wrapUp = await this.smart.finishWrapUp(await this.get(), input, this.sources.tasks);
    await this.refresh();
    return wrapUp;
  }

  /** Changes when the briefing would be about different data, so the AI rewrites it. */
  private sourcesKey(): string {
    const { calendar, email } = this.sources;
    const { carriedOver } = this.smart.wrapUpState();
    return [calendar.kind, email.kind, carriedOver?.finishedAt ?? ''].join('|');
  }

  private showBriefing(briefing: Briefing): void {
    if (!this.snapshot) return;
    this.snapshot = { ...this.snapshot, briefing };
    this.emit('snapshot', this.snapshot);
  }

  private async load(): Promise<DashboardSnapshot> {
    const { calendar, email, tasks, weather } = this.sources;
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

    const [events, inbox, taskList, weatherNow] = await Promise.all([
      attempt(calendar, () => calendar.listEvents({ start: startOfDay(0), end: startOfDay(2) }), []),
      attempt(email, () => email.listInbox({ limit: 25 }), []),
      attempt(tasks, () => tasks.listTasks(), []),
      attempt(weather, () => weather.getWeather(), null),
    ]);
    const triaged = await this.smart.triage(inbox);
    if (triaged.error) statuses.push({ name: 'AI email triage', kind: 'live', ok: false, error: triaged.error });
    const emails = this.smart.attachDrafts(triaged.emails);
    const { wrapUp, carriedOver } = this.smart.wrapUpState();

    const context: DayContext = { now: new Date(), events, emails, tasks: taskList, weather: weatherNow, carriedOver };
    this.lastContext = context;
    const briefing = this.smart.briefing(context, this.sourcesKey(), (b) => this.showBriefing(b));

    this.snapshot = {
      generatedAt: new Date().toISOString(),
      events,
      emails,
      tasks: taskList,
      weather: weatherNow,
      notes: this.notes.list(),
      sources: statuses,
      briefing,
      wrapUp,
      carriedOver,
      ai: { enabled: this.smart.writer() !== null, canSaveDrafts: this.canSaveDrafts() },
    };
    this.emit('snapshot', this.snapshot);
    return this.snapshot;
  }
}
