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

export interface EmailSource extends SourceInfo {
  listInbox(options: { limit: number }): Promise<EmailMessage[]>;
}

export interface TaskSource extends SourceInfo {
  listTasks(): Promise<Task[]>;
  addTask(input: { title: string; due?: string }): Promise<Task>;
  setDone(id: string, done: boolean): Promise<void>;
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
