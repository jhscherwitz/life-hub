import path from 'node:path';
import { isSameDay, formatTime } from '../../src/shared/time';
import type { Briefing, CalendarEvent, DashboardSnapshot, EmailMessage, SavedDraft, WrapUp } from '../../src/shared/types';
import type { EmailSource, TaskSource } from '../sources/types';
import { basicBriefing, briefingDate, writeBriefing } from './briefing';
import { ClaudeWriter, type AiWriter } from './claude';
import { tomorrowOf, type DayContext } from './context';
import { basicDraft, writeDraft } from './drafts';
import { JsonFile } from './store';
import { triageEmails, type TriageCache } from './triage';
import {
  basicWrapUpSummary,
  lastWrapUpBefore,
  previewWrapUp,
  saveToHistory,
  tomorrowIso,
  wrapUpFor,
  writeWrapUpSummary,
} from './wrapup';

/** After Claude fails to write the briefing, wait this long before trying again on its own. */
const RETRY_AFTER_MS = 30 * 60_000;
/** How many saved drafts to remember. */
const DRAFT_LIMIT = 200;

interface CachedBriefing {
  key: string;
  briefing: Briefing;
}

/**
 * The smart layer: the daily briefing, email triage, draft replies and the
 * evening wrap-up. Claude does the writing when an Anthropic API key is saved
 * in Settings; without one, Hub writes simpler versions itself, so everything
 * still works.
 */
export class SmartLayer {
  private cachedWriter: { apiKey: string; writer: AiWriter } | null = null;
  private readonly briefings: JsonFile<CachedBriefing | null>;
  private readonly triageCache: JsonFile<TriageCache>;
  private readonly drafts: JsonFile<Record<string, SavedDraft>>;
  private readonly wrapUps: JsonFile<WrapUp[]>;
  private writing: Promise<Briefing> | null = null;
  private failure: { key: string; at: number; message: string } | null = null;

  constructor(
    dataDir: string,
    private readonly apiKey: () => string | undefined,
    private readonly makeWriter: (apiKey: string) => AiWriter = (key) => new ClaudeWriter(key),
  ) {
    this.briefings = new JsonFile(path.join(dataDir, 'briefing.json'), () => null);
    this.triageCache = new JsonFile(path.join(dataDir, 'triage.json'), () => ({}));
    this.drafts = new JsonFile(path.join(dataDir, 'drafts.json'), () => ({}));
    this.wrapUps = new JsonFile(path.join(dataDir, 'wrapups.json'), () => []);
  }

  /** Claude, if an API key is saved. */
  writer(): AiWriter | null {
    const key = this.apiKey();
    if (!key) {
      this.cachedWriter = null;
      return null;
    }
    if (this.cachedWriter?.apiKey !== key) {
      this.cachedWriter = { apiKey: key, writer: this.makeWriter(key) };
      this.failure = null;
    }
    return this.cachedWriter.writer;
  }

  triage(emails: EmailMessage[]): Promise<{ emails: EmailMessage[]; error?: string }> {
    return triageEmails(emails, { writer: this.writer(), cache: this.triageCache });
  }

  /** Mark emails that already have a draft from Hub. */
  attachDrafts(emails: EmailMessage[]): EmailMessage[] {
    const drafts = this.drafts.read();
    return emails.map((m) => (drafts[m.id] ? { ...m, draft: drafts[m.id] } : m));
  }

  /** Today's wrap-up (once done) and the last one before today (its items carry into today). */
  wrapUpState(now = new Date()): { wrapUp: WrapUp | null; carriedOver: WrapUp | null } {
    const history = this.wrapUps.read();
    return { wrapUp: wrapUpFor(history, now), carriedOver: lastWrapUpBefore(history, now) };
  }

  private basic(ctx: DayContext): Briefing {
    return { ...basicBriefing(ctx), date: briefingDate(ctx.now), writtenBy: 'basic', generatedAt: ctx.now.toISOString() };
  }

  /**
   * The briefing to show now. Claude writes one per day (or when the data
   * sources change, e.g. after signing in to Google); while it writes, and if
   * it can't, Hub's basic briefing shows. `onWritten` gets Claude's version.
   */
  briefing(ctx: DayContext, sourcesKey: string, onWritten: (b: Briefing) => void): Briefing {
    const writer = this.writer();
    if (!writer) return this.basic(ctx);
    const key = `${briefingDate(ctx.now)}|${sourcesKey}`;
    const cached = this.briefings.read();
    if (cached?.key === key) return cached.briefing;
    if (this.failure?.key === key && Date.now() - this.failure.at < RETRY_AFTER_MS) {
      return { ...this.basic(ctx), error: this.failure.message };
    }
    if (!this.writing) {
      void this.generate(writer, ctx, key).then(onWritten);
    }
    return { ...this.basic(ctx), writing: true };
  }

  /** Ask Claude for a fresh briefing now, ignoring the saved one. */
  async rewriteBriefing(ctx: DayContext, sourcesKey: string): Promise<Briefing> {
    const writer = this.writer();
    if (!writer) return this.basic(ctx);
    this.failure = null;
    await this.writing?.catch(() => undefined);
    return this.generate(writer, ctx, `${briefingDate(ctx.now)}|${sourcesKey}`);
  }

  private generate(writer: AiWriter, ctx: DayContext, key: string): Promise<Briefing> {
    const run = async (): Promise<Briefing> => {
      try {
        const written = await writeBriefing(writer, ctx);
        const briefing: Briefing = { ...written, date: briefingDate(ctx.now), writtenBy: 'claude', generatedAt: new Date().toISOString() };
        this.briefings.write({ key, briefing });
        this.failure = null;
        return briefing;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.failure = { key, at: Date.now(), message };
        return { ...this.basic(ctx), error: message };
      }
    };
    this.writing = run().finally(() => {
      this.writing = null;
    });
    return this.writing;
  }

  /**
   * Write a reply and save it as a Gmail draft. Hub never sends it: Jacob
   * reviews and sends it from Gmail.
   */
  async draftReply(email: EmailMessage, source: EmailSource, events: CalendarEvent[]): Promise<SavedDraft> {
    const original = await source.getMessage(email.id);
    const writer = this.writer();
    const body = writer ? await writeDraft(writer, original, events) : basicDraft(original);
    const saved = await source.saveDraft(original, body);
    const draft: SavedDraft = {
      body,
      savedToGmail: saved !== null,
      url: saved?.url ?? email.url,
      writtenBy: writer ? 'claude' : 'basic',
      createdAt: new Date().toISOString(),
    };
    const all = { ...this.drafts.read(), [email.id]: draft };
    const kept = Object.entries(all)
      .sort((a, b) => b[1].createdAt.localeCompare(a[1].createdAt))
      .slice(0, DRAFT_LIMIT);
    this.drafts.write(Object.fromEntries(kept));
    return draft;
  }

  previewWrapUp(snapshot: DashboardSnapshot, now = new Date()) {
    return previewWrapUp(snapshot, now);
  }

  /**
   * Finish the day: the chosen unfinished tasks move to tomorrow, and the
   * chosen items and note are saved for tomorrow morning's briefing.
   */
  async finishWrapUp(
    snapshot: DashboardSnapshot,
    input: { carryOver: string[]; note: string },
    tasks: TaskSource,
    now = new Date(),
  ): Promise<WrapUp> {
    const preview = previewWrapUp(snapshot, now);
    const carryOver = preview.unfinished.filter((i) => input.carryOver.includes(i.id));
    const tomorrow = tomorrowIso(now);
    for (const item of carryOver) {
      if (item.kind === 'task') await tasks.setDue(item.id.slice('task:'.length), tomorrow);
    }
    const note = input.note.trim() || undefined;
    const base = { date: preview.date, done: preview.done, meetings: preview.meetings, carryOver, note };

    let summary = basicWrapUpSummary(base);
    let writtenBy: WrapUp['writtenBy'] = 'basic';
    const writer = this.writer();
    if (writer) {
      const tomorrowEvents = snapshot.events
        .filter((e) => isSameDay(e.start, tomorrowOf(now)))
        .map((e) => `${e.allDay ? 'all day' : formatTime(e.start)}: ${e.title}`);
      try {
        summary = await writeWrapUpSummary(writer, base, tomorrowEvents);
        writtenBy = 'claude';
      } catch {
        // The basic summary is fine; the wrap-up itself is what matters.
      }
    }

    const wrapUp: WrapUp = { ...base, finishedAt: new Date().toISOString(), summary, writtenBy };
    this.wrapUps.write(saveToHistory(this.wrapUps.read(), wrapUp));
    return wrapUp;
  }
}
