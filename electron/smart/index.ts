import path from 'node:path';
import { CHAT_SCHEMA, cleanActions, type ChatAction } from '../../src/shared/actions';
import { isSameDay, formatTime } from '../../src/shared/time';
import type { Briefing, CalendarEvent, DashboardSnapshot, EmailMessage, InboxSummary, SavedDraft, WrapUp } from '../../src/shared/types';
import type { EmailSource, TaskSource } from '../sources/types';
import { basicBriefing, briefingDate, writeBriefing } from './briefing';
import type { AiWriter, ChatMessage } from '../ai/types';
import { describeDay, tomorrowOf, type DayContext } from './context';
import { basicDraft, writeDraft } from './drafts';
import { JsonFile } from './store';
import { triageEmails, type TriageCache } from './triage';
import { findPlans, type PlanCache } from './plans';
import type { EmailPlan } from '../../src/shared/plans';
import { basicWrapUpSummary, lastWrapUpBefore, previewWrapUp, saveToHistory, tomorrowIso, wrapUpFor, writeWrapUpSummary } from './wrapup';

/** After the AI fails to write the briefing, wait this long before trying again on its own. */
const RETRY_AFTER_MS = 30 * 60_000;
/** How many saved drafts to remember. */
const DRAFT_LIMIT = 200;

interface CachedBriefing {
  key: string;
  briefing: Briefing;
}

/** What Chat knows about their stocks: the ones they typed into Life Hub, live prices and headlines. */
function portfolioSection(portfolio: string | null | undefined): string {
  return portfolio
    ? `Their stocks and crypto (what they told Life Hub they own, with live prices and recent headlines). When they ask about their stocks, use this; say what moved and, if a headline explains it, why. Don't give financial advice or tell them to buy or sell.\n\n${portfolio}`
    : "They haven't told Life Hub about any stocks yet. If they ask, say they can add them in the Portfolio widget or just tell you what they own.";
}

/**
 * The smart layer: the daily briefing, email triage, draft replies, inbox
 * summaries, chat and the evening wrap-up. Free AI (a Gemini key or Ollama on
 * this computer) does the writing when it's turned on in Settings; without it,
 * Hub writes simpler versions itself, so everything still works.
 */
export class SmartLayer {
  private lastWriter: AiWriter | null = null;
  private readonly briefings: JsonFile<CachedBriefing | null>;
  private readonly triageCache: JsonFile<TriageCache>;
  private readonly planCache: JsonFile<PlanCache>;
  private readonly drafts: JsonFile<Record<string, SavedDraft>>;
  private readonly wrapUps: JsonFile<WrapUp[]>;
  private readonly inboxSummaries: JsonFile<{ key: string; summary: InboxSummary } | null>;
  private writing: Promise<Briefing> | null = null;
  private failure: { key: string; at: number; message: string } | null = null;

  constructor(
    dataDir: string,
    /** The AI from Settings, or null when it's off. */
    private readonly ai: () => AiWriter | null,
  ) {
    this.briefings = new JsonFile(path.join(dataDir, 'briefing.json'), () => null);
    this.triageCache = new JsonFile(path.join(dataDir, 'triage.json'), () => ({}));
    this.planCache = new JsonFile(path.join(dataDir, 'email-plans.json'), () => ({}));
    this.drafts = new JsonFile(path.join(dataDir, 'drafts.json'), () => ({}));
    this.wrapUps = new JsonFile(path.join(dataDir, 'wrapups.json'), () => []);
    this.inboxSummaries = new JsonFile(path.join(dataDir, 'inbox-summary.json'), () => null);
  }

  /** The AI, if it's turned on in Settings. */
  writer(): AiWriter | null {
    const writer = this.ai() ?? null;
    // A different AI (just turned on, or switched) gets a fresh try.
    if (writer !== this.lastWriter) this.failure = null;
    this.lastWriter = writer;
    return writer;
  }

  triage(emails: EmailMessage[]): Promise<{ emails: EmailMessage[]; error?: string }> {
    return triageEmails(emails, { writer: this.writer(), cache: this.triageCache });
  }

  /** Plans with a date found in recent email (AI only). */
  plans(emails: EmailMessage[]): Promise<{ plans: EmailPlan[]; error?: string }> {
    return findPlans(emails, { writer: this.writer(), cache: this.planCache });
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
   * The briefing to show now. The AI writes one per day (or when the data
   * sources change, e.g. after signing in to Google); while it writes, and if
   * it can't, Hub's basic briefing shows. `onWritten` gets the AI's version.
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

  /** Resolves once the AI has finished any briefing it's writing. */
  async briefingSettled(): Promise<void> {
    await this.writing?.catch(() => undefined);
  }

  /** Ask the AI for a fresh briefing now, ignoring the saved one. */
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
        const briefing: Briefing = { ...written, date: briefingDate(ctx.now), writtenBy: 'ai', generatedAt: new Date().toISOString() };
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
      writtenBy: writer ? 'ai' : 'basic',
      createdAt: new Date().toISOString(),
    };
    const all = { ...this.drafts.read(), [email.id]: draft };
    const kept = Object.entries(all)
      .sort((a, b) => b[1].createdAt.localeCompare(a[1].createdAt))
      .slice(0, DRAFT_LIMIT);
    this.drafts.write(Object.fromEntries(kept));
    return draft;
  }

  /**
   * A short summary of the whole inbox plus one line per email, so you don't
   * have to open Gmail. Saved until the inbox changes.
   */
  async summarizeInbox(emails: EmailMessage[]): Promise<InboxSummary> {
    const writer = this.writer();
    if (!writer) throw new Error('Turn on free AI in Settings to summarize your inbox.');
    const key = emails.map((m) => m.id).join(',');
    const saved = this.inboxSummaries.read();
    if (saved?.key === key) return saved.summary;
    if (emails.length === 0) return { overview: 'Your inbox is empty.', items: {}, generatedAt: new Date().toISOString() };

    const list = emails.map((m) => `[${m.id}] From ${m.from.name} <${m.from.email}>, ${m.receivedAt.slice(0, 16)}: "${m.subject}". ${m.snippet}`).join('\n');
    const result = await writer.json<{ overview: string; items: { id: string; summary: string }[] }>({
      system: "You summarize a person's email inbox for their personal dashboard. Be plain and short. Never make up details that aren't in the emails.",
      prompt: `Here are the newest emails, one per line, each starting with its id in square brackets:\n${list}\n\nWrite an overview of 2 or 3 sentences: what matters, who is waiting on a reply, and what can be ignored. Then give each email a one-sentence summary of what it says or asks, using its id.`,
      schema: {
        type: 'object',
        properties: {
          overview: { type: 'string' },
          items: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, summary: { type: 'string' } }, required: ['id', 'summary'] } },
        },
        required: ['overview', 'items'],
      },
      effort: 'low',
    });
    const ids = new Set(emails.map((m) => m.id));
    const summary: InboxSummary = {
      overview: result.overview?.trim() || 'No overview this time.',
      items: Object.fromEntries((result.items ?? []).filter((i) => ids.has(i.id) && i.summary?.trim()).map((i) => [i.id, i.summary.trim()])),
      generatedAt: new Date().toISOString(),
    };
    this.inboxSummaries.write({ key, summary });
    return summary;
  }

  /** A chat reply that knows about the person's day. */
  async chat(ctx: DayContext | null, messages: ChatMessage[], extra: { portfolio?: string | null } = {}): Promise<string> {
    const writer = this.writer();
    if (!writer) throw new Error('Turn on free AI in Settings to chat.');
    const system = [
      "You are the assistant inside Life Hub, a person's daily dashboard. Answer briefly and plainly, like a helpful friend. Use short paragraphs or lists.",
      'You can see their calendar, inbox and tasks below. If they ask you to send an email, tell them to use Draft on the email in Life Hub.',
      ctx ? `Their day:\n\n${describeDay(ctx)}` : "Their day hasn't loaded yet.",
      portfolioSection(extra.portfolio),
    ].join('\n\n');
    return (await writer.chat({ system, messages: messages.slice(-20) })).trim();
  }

  /**
   * Chat that can do things: the AI answers and, when asked, lists actions
   * (add a task, countdown, note or reminder, or tick off a daily task). It
   * gives dates in plain words; Life Hub works out the real date itself. If
   * the AI's answer can't be read, it falls back to a plain reply.
   */
  async chatAct(
    ctx: DayContext | null,
    messages: ChatMessage[],
    extra: { habits: string[]; portfolio?: string | null; now?: Date },
  ): Promise<{ reply: string; actions: ChatAction[] }> {
    const writer = this.writer();
    if (!writer) throw new Error('Turn on free AI in Settings to chat.');
    const now = extra.now ?? new Date();
    const system = [
      "You are the assistant inside Life Hub, a person's daily dashboard. Answer briefly and plainly, like a helpful friend.",
      `Right now it is ${now.toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.`,
      [
        'You can also DO things by listing actions. Only add an action when the person clearly asks for it; never invent tasks.',
        '- add_task: a to-do. title = the task, when = its due day/time in plain words if they gave one ("friday 3pm", "tomorrow", "nov 12").',
        '- add_countdown: count down to a day (exam, trip, birthday). title = what, when = the day.',
        '- add_note: save a note. title = the note text.',
        '- remind: a reminder at a time. title = what to remind them, when = the time ("6pm", "tomorrow 9am", "in 20 minutes"). They get a notification then.',
        `- tick_habit: mark one of their daily tasks done. title = its name. Their daily tasks are: ${extra.habits.length ? extra.habits.join(', ') : '(none)'}.`,
        '- set_holding: when they tell you about stocks or crypto they own, bought or sold. title = the ticker (AAPL, VOO, BTC), shares = how many they own NOW in total. If they bought or sold some, add to or take away from what they already own (listed below). 0 if they sold it all.',
        '- remove_holding: stop tracking a stock. title = the ticker.',
        'Keep "when" in plain words exactly like they said it; do not convert it to a different date. In "reply", say briefly what you did or answer the question.',
        'They can attach pictures (a syllabus, a flyer, a schedule, a screenshot, homework). Read them. When they ask, turn what is in them into actions, like one add_task per assignment with its due date.',
      ].join('\n'),
      ctx ? `Their day:\n\n${describeDay(ctx)}` : "Their day hasn't loaded yet.",
      portfolioSection(extra.portfolio),
    ].join('\n\n');
    const recent = messages.slice(-12);
    const transcript = recent.map((m) => `${m.role === 'user' ? 'Them' : 'You'}: ${m.content}`).join('\n\n');
    // Pictures attached to their last message (a syllabus, a flyer, a screenshot...).
    const images = recent[recent.length - 1]?.images;
    const pictureNote = images?.length ? `\n\nThey attached ${images.length === 1 ? 'a picture' : `${images.length} pictures`} to their last message; it's included. Read it carefully.` : '';
    try {
      const result = await writer.json<{ reply?: string; actions?: unknown }>({
        system,
        prompt: `The conversation so far:\n\n${transcript}${pictureNote}\n\nAnswer their last message.`,
        schema: CHAT_SCHEMA,
        effort: 'low',
        ...(images?.length && { images }),
      });
      const reply = (result.reply ?? '').trim();
      const actions = cleanActions(result.actions);
      if (reply || actions.length) return { reply: reply || 'Done.', actions };
    } catch {
      // Fall back to a plain answer below.
    }
    return { reply: await this.chat(ctx, messages, extra), actions: [] };
  }

  previewWrapUp(snapshot: DashboardSnapshot, now = new Date()) {
    return previewWrapUp(snapshot, now);
  }

  /**
   * Finish the day: the chosen unfinished tasks move to tomorrow, and the
   * chosen items and note are saved for tomorrow morning's briefing.
   */
  async finishWrapUp(snapshot: DashboardSnapshot, input: { carryOver: string[]; note: string }, tasks: TaskSource, now = new Date()): Promise<WrapUp> {
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
        writtenBy = 'ai';
      } catch {
        // The basic summary is fine; the wrap-up itself is what matters.
      }
    }

    const wrapUp: WrapUp = { ...base, finishedAt: new Date().toISOString(), summary, writtenBy };
    this.wrapUps.write(saveToHistory(this.wrapUps.read(), wrapUp));
    return wrapUp;
  }
}
