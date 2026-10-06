import type { CalendarEvent, EmailMessage, MailChange, Task, Weather } from '../../src/shared/types';

// The contracts a data source has to meet. The sample sources implement these
// with fake data; the real ones (Google Calendar, Gmail, Open-Meteo weather,
// Hub's own task list) implement the same interfaces.
// `createSources()` in ./index.ts picks which backs each part of the dashboard.

export interface SourceInfo {
  /** Human-readable name, e.g. "Google Calendar". */
  readonly name: string;
  readonly kind: 'sample' | 'live';
}

export interface CalendarSource extends SourceInfo {
  listEvents(range: { start: Date; end: Date }): Promise<CalendarEvent[]>;
  /** Events matching some words, from about a year around today. Live sources only. */
  search?(query: string, limit: number): Promise<CalendarEvent[]>;
  /** Adds an event to the main calendar. Live sources only. */
  addEvent?(input: NewEvent): Promise<CalendarEvent>;
  /** Removes an event Life Hub added (by the id addEvent gave). */
  removeEvent?(id: string): Promise<void>;
  /** Moves an event (by its ref) to a new time; returns where it was. */
  moveEvent?(ref: string, to: { date: string; time?: string; minutes?: number }): Promise<{ before: unknown; event: CalendarEvent }>;
  /** Puts a moved event back. */
  setEventTimes?(ref: string, times: never): Promise<void>;
  /** Cancels an event (by its ref); returns what's needed to put it back. */
  cancelEvent?(ref: string): Promise<{ calendarId: string; copy: Record<string, unknown>; title: string }>;
  /** Puts a cancelled event back. */
  restoreEvent?(calendarId: string, copy: Record<string, unknown>): Promise<void>;
}

/** An event to add: a start (local time), and an end or all day. */
export interface NewEvent {
  title: string;
  /** "YYYY-MM-DD" for all day, or a full local date and time. */
  date: string;
  /** "HH:MM", or none for an all-day event. */
  time?: string;
  minutes?: number;
  location?: string;
}

/** One message in full, for writing a reply to it. */
export interface EmailDetail {
  id: string;
  threadId?: string;
  from: { name: string; email: string };
  /** Where replies should go, if the sender set a Reply-To. */
  replyTo?: string;
  subject: string;
  /** The message text, without the quoted history below it. */
  body: string;
  receivedAt: string;
  /** The Message-ID and References headers, so the reply threads correctly. */
  messageId?: string;
  references?: string;
}

export interface EmailSource extends SourceInfo {
  /** The newest conversations in the inbox, one entry per conversation. */
  listInbox(options: { limit: number }): Promise<EmailMessage[]>;
  getMessage(id: string): Promise<EmailDetail>;
  /**
   * Save a reply as a draft (never sent). Returns where to open it, or null
   * when this source can't save drafts (sample email).
   */
  saveDraft(original: EmailDetail, body: string): Promise<{ url: string; id?: string } | null>;
  /** A brand-new email saved as a draft. Missing where drafts can't be saved. */
  saveNewDraft?(to: string, subject: string, body: string): Promise<{ url: string; id?: string }>;
  /** Deletes a draft Life Hub saved (for Undo). Live sources only. */
  deleteDraft?(id: string): Promise<void>;
  /** Mail anywhere in the mailbox matching some words. Live sources only. */
  search?(query: string, limit: number): Promise<EmailMessage[]>;
  /** Archive, delete (to Trash), star or mark a conversation. Live sources only. */
  changeMail?(threadId: string, change: MailChange): Promise<void>;
}

export interface TaskSource extends SourceInfo {
  listTasks(): Promise<Task[]>;
  addTask(input: { title: string; due?: string }): Promise<Task>;
  setDone(id: string, done: boolean): Promise<void>;
  /** Move a task to another day (YYYY-MM-DD). */
  setDue(id: string, due: string): Promise<void>;
  removeTask(id: string): Promise<void>;
}

export interface WeatherSource extends SourceInfo {
  getWeather(): Promise<Weather>;
}

export interface Sources {
  calendar: CalendarSource;
  email: EmailSource;
  tasks: TaskSource;
  weather: WeatherSource;
}
