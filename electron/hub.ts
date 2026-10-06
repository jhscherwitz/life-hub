import { EventEmitter } from 'node:events';
import type {
  Briefing,
  CalendarEvent,
  Note,
  Task,
  EmailMessage,
  CaptureInput,
  DashboardSnapshot,
  InboxSummary,
  SavedDraft,
  SourceStatus,
  WrapUp,
  WrapUpPreview,
} from '../src/shared/types';
import type { NoteStore } from './notes';
import type { ChatMessage } from './ai/types';
import { runTool, type ToolDeps } from './smart/tools';
import type { ToolCall, ToolStep } from '../src/shared/tools';
import type { ActionResult, ChatAction } from '../src/shared/actions';

/** What Chat needs to look things up, besides the AI and this Hub's email and calendar. */
type Lookups = Omit<ToolDeps, 'writer' | 'email' | 'calendar'> & {
  onStep?: (step: ToolStep & { running?: boolean }) => void;
  /** Does one action right away (step-by-step chat). */
  act?: (action: ChatAction) => Promise<ActionResult>;
  /** Each bit of the answer as it's written. */
  onText?: (delta: string) => void;
  /** The Stop button. */
  signal?: AbortSignal;
};
import type { SmartLayer } from './smart';
import type { CommuteNow, DayContext } from './smart/context';
import type { Sources } from './sources';
import type { NewEvent } from './sources/types';
import type { MailChange } from '../src/shared/types';
import { mailId, oneEach, rangeLimit, rangeStart, type InboxDigest, type InboxRange } from '../src/shared/inbox';
import { upcomingPlans } from '../src/shared/plans';
import { localIsoDate } from '../src/shared/time';
import { dueValue, parseWhen } from '../src/shared/when';

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
  /** Where the commute comes from, for the briefing (only while the Commute widget is on the dashboard). */
  private commuteFor: (() => Promise<CommuteNow | null>) | null = null;
  setCommute(fn: () => Promise<CommuteNow | null>): void {
    this.commuteFor = fn;
  }

  /** Canvas work due this week, for the briefing. */
  private canvasDueFor: (() => Promise<string | null>) | null = null;
  setCanvasDue(fn: () => Promise<string | null>): void {
    this.canvasDueFor = fn;
  }

  /** The dashboard's widgets in words, so Chat can arrange them. */
  private widgets: (() => string) | null = null;
  setWidgets(fn: () => string): void {
    this.widgets = fn;
  }

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

  /**
   * Adds a task, reading a day and time out of the words ("chem quiz friday
   * 3pm" is "Chem quiz", due Friday at 3 PM). A due date passed in wins.
   */
  async addTask(title: string, due?: string): Promise<Task | null> {
    const text = title.trim();
    if (!text) return null;
    const parsed = parseWhen(text);
    const task = await this.sources.tasks.addTask({ title: parsed.title || text, due: due ?? dueValue(parsed) });
    await this.refresh();
    return task;
  }

  /** Every task, as the task list has them. */
  listTasks(): Promise<Task[]> {
    return this.sources.tasks.listTasks();
  }

  /** Adds a task exactly as given (no reading a date out of the words), without reloading. */
  addTaskAsIs(title: string, due?: string): Promise<Task> {
    return this.sources.tasks.addTask({ title, due });
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
      await this.refresh();
    } else {
      await this.addTask(text);
    }
  }

  async addNote(text: string): Promise<Note | null> {
    const clean = text.trim();
    if (!clean) return null;
    const note = this.notes.add(clean);
    await this.refresh();
    return note;
  }

  async removeNote(id: string): Promise<void> {
    this.notes.remove(id);
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

  async draftReply(emailId: string, instructions?: string): Promise<SavedDraft> {
    const snapshot = await this.get();
    // By message or conversation id; one from a search may not be in the inbox list.
    const email: EmailMessage | undefined =
      snapshot.emails.find((m) => m.id === emailId || m.threadId === emailId) ??
      (instructions !== undefined ? { id: emailId, from: { name: '', email: '' }, subject: '', snippet: '', receivedAt: new Date().toISOString(), unread: false } : undefined);
    if (!email) throw new Error('That email is no longer in your inbox. Click Refresh.');
    if (this.sources.email.kind === 'live' && !this.canSaveDrafts()) {
      throw new Error('Life Hub needs your permission to save drafts. Open Settings, click Sign out, then Sign in with Google and tick every box.');
    }
    const draft = await this.smart.draftReply(email, this.sources.email, snapshot.events, instructions);
    if (this.snapshot) {
      this.snapshot = { ...this.snapshot, emails: this.snapshot.emails.map((m) => (m.id === email.id ? { ...m, draft } : m)) };
      this.emit('snapshot', this.snapshot);
    }
    return draft;
  }

  /** A new email (not a reply) saved as a Gmail draft for them to check and send. */
  async newDraft(to: string, instructions: string, subjectHint?: string): Promise<{ url: string; id?: string; subject: string; body: string }> {
    const email = this.sources.email;
    if (!email.saveNewDraft) throw new Error('Connect your Google account in Settings so the AI can write emails.');
    if (email.kind === 'live' && !this.canSaveDrafts()) {
      throw new Error('Life Hub needs your permission to save drafts. Open Settings, click Sign out, then Sign in with Google and tick every box.');
    }
    // Past email with them gives the AI their name and the right tone (a professor vs. a friend).
    let history: EmailMessage[] = [];
    try {
      history = email.search ? await email.search(`from:${to} OR to:${to}`, 5) : [];
    } catch {
      // Write it without; the address and their words still say a lot.
    }
    const written = await this.smart.writeNewEmail(
      to,
      instructions,
      history.map((m) => ({ from: m.from.name ? `${m.from.name} <${m.from.email}>` : m.from.email, subject: m.subject, snippet: m.snippet, date: m.receivedAt.slice(0, 10) })),
      subjectHint,
    );
    const saved = await email.saveNewDraft(to, written.subject, written.body);
    return { ...saved, subject: written.subject, body: written.body };
  }

  /** Deletes a draft Life Hub saved (Undo in chat). */
  async deleteDraft(id: string): Promise<void> {
    await this.sources.email.deleteDraft?.(id);
  }

  /** Emails from a stretch of days (one per conversation), sorted by the AI into look into / probably delete. */
  async inboxDigest(range: InboxRange): Promise<InboxDigest> {
    const now = new Date();
    const start = rangeStart(range, now);
    const email = this.sources.email;
    let emails: EmailMessage[];
    if (email.search) {
      // Gmail's search takes seconds since 1970 for an exact start.
      emails = await email.search(`in:inbox after:${Math.floor(start.getTime() / 1000)}`, rangeLimit(range));
    } else {
      emails = (await email.listInbox({ limit: rangeLimit(range) })).filter((m) => new Date(m.receivedAt) >= start);
    }
    const snapshot = this.snapshot?.emails ?? [];
    // Keep what triage already knows (needs a reply) for the same conversations.
    const known = new Map(snapshot.map((m) => [mailId(m), m]));
    emails = oneEach(emails).map((m) => ({ ...m, ...(known.get(mailId(m))?.needsReply && { needsReply: true }) }));
    return this.smart.digestInbox(emails, range, now);
  }

  async summarizeInbox(): Promise<InboxSummary> {
    const snapshot = await this.get();
    return this.smart.summarizeInbox(snapshot.emails);
  }

  /**
   * Chat that can do things and look things up. `lookups` gives the AI its
   * tools (the web, stock history, and this Hub's email and calendar).
   */
  async chatAct(
    messages: ChatMessage[],
    habits: string[],
    portfolio?: string | null,
    lookups?: Lookups,
    groceries: string[] = [],
  ) {
    if (!this.lastContext) await this.get();
    const writer = this.smart.writer();
    const { onStep, act, onText, signal, ...deps } = lookups ?? {};
    const tools =
      writer && lookups
        ? (call: ToolCall) => runTool(call, { ...(deps as Omit<Lookups, 'onStep' | 'act' | 'onText' | 'signal'>), writer, email: this.sources.email, calendar: this.sources.calendar })
        : undefined;
    return this.smart.chatAct(this.lastContext, messages, {
      habits,
      portfolio,
      groceries,
      tools,
      onStep,
      act,
      onText,
      signal,
      browserPage: lookups?.browser?.status() ?? null,
      widgets: this.widgets?.() ?? null,
      profile: this.profileFor?.() ?? null,
    });
  }

  /**
   * Archive, delete, star or mark an email. The inbox on screen changes at
   * once; Gmail is told, then everything reloads.
   */
  async changeMail(threadId: string, change: MailChange): Promise<void> {
    const email = this.sources.email;
    if (!email.changeMail) throw new Error('Connect your Google account in Settings to change your email from Life Hub.');
    if (this.snapshot) {
      const gone = change === 'archive' || change === 'trash';
      const emails = this.snapshot.emails
        .filter((m) => !(gone && (m.threadId ?? m.id) === threadId))
        .map((m) => ((m.threadId ?? m.id) !== threadId ? m : change === 'star' || change === 'unstar' ? { ...m, starred: change === 'star' } : change === 'read' || change === 'unread' ? { ...m, unread: change === 'unread' } : m));
      this.snapshot = { ...this.snapshot, emails };
      this.emit('snapshot', this.snapshot);
    }
    try {
      await email.changeMail(threadId, change);
    } finally {
      void this.refresh().catch(() => undefined);
    }
  }

  /** An email on screen, by its conversation or message id, for the AI's action cards. */
  findEmail(id: string): EmailMessage | undefined {
    return this.snapshot?.emails.find((m) => m.threadId === id || m.id === id);
  }

  /** Adds an event to Google Calendar, then reloads so it shows everywhere. */
  async addEvent(input: NewEvent): Promise<CalendarEvent> {
    const cal = this.sources.calendar;
    if (!cal.addEvent) throw new Error('Connect your Google account in Settings to add things to your calendar.');
    const event = await cal.addEvent(input);
    void this.refresh().catch(() => undefined);
    return event;
  }

  async removeEvent(id: string): Promise<void> {
    await this.sources.calendar.removeEvent?.(id);
    void this.refresh().catch(() => undefined);
  }

  /** An upcoming event you can change, found by its ref or by words in its title. */
  async findEvent(nameOrRef: string): Promise<CalendarEvent | null> {
    const now = Date.now();
    const events = (await this.sources.calendar.listEvents({ start: new Date(now - 86_400_000), end: new Date(now + 90 * 86_400_000) })).filter((e) => e.ref);
    const exact = events.find((e) => e.ref === nameOrRef);
    if (exact) return exact;
    const want = nameOrRef.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    if (!want) return null;
    const upcoming = events.filter((e) => Date.parse(e.end) >= now);
    const named = (e: CalendarEvent) => e.title.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    return upcoming.find((e) => named(e) === want) ?? upcoming.find((e) => named(e).includes(want) || want.includes(named(e))) ?? null;
  }

  async moveEvent(ref: string, to: { date: string; time?: string; minutes?: number }) {
    const cal = this.sources.calendar;
    if (!cal.moveEvent) throw new Error('Connect your Google account in Settings to change your calendar.');
    const out = await cal.moveEvent(ref, to);
    void this.refresh().catch(() => undefined);
    return out;
  }

  async setEventTimes(ref: string, times: unknown): Promise<void> {
    await this.sources.calendar.setEventTimes?.(ref, times as never);
    void this.refresh().catch(() => undefined);
  }

  async cancelEvent(ref: string) {
    const cal = this.sources.calendar;
    if (!cal.cancelEvent) throw new Error('Connect your Google account in Settings to change your calendar.');
    const out = await cal.cancelEvent(ref);
    void this.refresh().catch(() => undefined);
    return out;
  }

  async restoreEvent(calendarId: string, copy: Record<string, unknown>): Promise<void> {
    await this.sources.calendar.restoreEvent?.(calendarId, copy);
    void this.refresh().catch(() => undefined);
  }

  /** Gmail's own search, for learning who's who (empty with sample email). */
  async emailSearch(query: string, limit: number): Promise<EmailMessage[]> {
    const email = this.sources.email;
    return email.search ? email.search(query, limit) : [];
  }

  /** What Life Hub has learned about them, for Chat. */
  private profileFor: (() => string | null) | null = null;
  setProfile(fn: () => string | null): void {
    this.profileFor = fn;
  }

  /** Events in any stretch of time (up to about three months), for the Calendar page. */
  async eventsBetween(startIso: string, endIso: string): Promise<CalendarEvent[]> {
    const start = new Date(startIso);
    const end = new Date(endIso);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) throw new Error('That date range makes no sense.');
    if (end.getTime() - start.getTime() > 100 * 86_400_000) throw new Error('Ask for three months or less at a time.');
    return this.sources.calendar.listEvents({ start, end });
  }

  async chat(messages: ChatMessage[], portfolio?: string | null): Promise<string> {
    if (!this.lastContext) await this.get();
    return this.smart.chat(this.lastContext, messages, { portfolio });
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
    // Adding the Commute widget (or taking it off) rewrites the briefing to match.
    return [calendar.kind, email.kind, carriedOver?.finishedAt ?? '', this.lastContext?.commute ? 'commute' : '', this.lastContext?.canvasDue ? 'canvas' : ''].join('|');
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

    // The commute is a nice-to-have: never let it hold up or break the dashboard.
    const commuteJob = this.commuteFor
      ? Promise.race([this.commuteFor().catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 12_000))])
      : Promise.resolve(null);
    const [events, inbox, taskList, weatherNow] = await Promise.all([
      attempt(calendar, () => calendar.listEvents({ start: startOfDay(0), end: startOfDay(2) }), []),
      attempt(email, () => email.listInbox({ limit: 25 }), []),
      attempt(tasks, () => tasks.listTasks(), []),
      attempt(weather, () => weather.getWeather(), null),
    ]);
    const [triaged, found] = await Promise.all([this.smart.triage(inbox), this.smart.plans(inbox)]);
    if (triaged.error) statuses.push({ name: 'AI email triage', kind: 'live', ok: false, error: triaged.error });
    if (found.error) statuses.push({ name: 'AI plans from email', kind: 'live', ok: false, error: found.error });
    const plans = upcomingPlans(found.plans, events, localIsoDate(new Date()));
    const emails = this.smart.attachDrafts(triaged.emails);
    const { wrapUp, carriedOver } = this.smart.wrapUpState();

    const commute = await commuteJob;
    const canvasDue = this.canvasDueFor
      ? await Promise.race([this.canvasDueFor().catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 8_000))])
      : null;
    const context: DayContext = { now: new Date(), events, emails, tasks: taskList, weather: weatherNow, carriedOver, plans, commute, canvasDue };
    this.lastContext = context;
    const briefing = this.smart.briefing(context, this.sourcesKey(), (b) => this.showBriefing(b));

    this.snapshot = {
      generatedAt: new Date().toISOString(),
      events,
      emails,
      plans,
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
