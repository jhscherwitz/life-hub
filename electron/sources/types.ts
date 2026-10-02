import type { CalendarEvent, Commute, EmailMessage, Task, Weather } from '../../src/shared/types';

// The contracts a data source has to meet. The sample sources implement these
// with fake data; real integrations (Google Calendar, Gmail, a task app,
// a weather API) implement the same interfaces and get swapped in via
// `createSources()` in ./index.ts. Nothing else in the app has to change.

export interface SourceInfo {
  /** Human-readable name, e.g. "Google Calendar". */
  readonly name: string;
  readonly kind: 'sample' | 'live';
}

export interface CalendarSource extends SourceInfo {
  listEvents(range: { start: Date; end: Date }): Promise<CalendarEvent[]>;
}

export interface EmailSource extends SourceInfo {
  listInbox(options: { limit: number }): Promise<EmailMessage[]>;
}

export interface TaskSource extends SourceInfo {
  listTasks(): Promise<Task[]>;
  addTask(input: { title: string; due?: string }): Promise<Task>;
  setDone(id: string, done: boolean): Promise<void>;
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
