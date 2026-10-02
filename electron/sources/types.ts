import type { CalendarEvent, Commute, EmailMessage, Task, Weather } from '../../src/shared/types';

// The contracts a data source has to meet. The sample sources implement these
// with fake data; the real ones (Google Calendar, Gmail, Open-Meteo weather,
// OpenStreetMap commute, Hub's own task list) implement the same interfaces.
// `createSources()` in ./index.ts picks which backs each part of the dashboard.

export interface SourceInfo {
  /** Human-readable name, e.g. "Google Calendar". */
  readonly name: string;
  readonly kind: 'sample' | 'live';
}

export interface CalendarSource extends SourceInfo {
  listEvents(range: { start: Date; end: Date }): Promise<CalendarEvent[]>;
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
  saveDraft(original: EmailDetail, body: string): Promise<{ url: string } | null>;
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

export interface CommuteSource extends SourceInfo {
  /** Travel estimate to the first in-person event of the day, or null if there isn't one. */
  getCommute(events: CalendarEvent[]): Promise<Commute | null>;
}

export interface Sources {
  calendar: CalendarSource;
  email: EmailSource;
  tasks: TaskSource;
  weather: WeatherSource;
  commute: CommuteSource;
}
