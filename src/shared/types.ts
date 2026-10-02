// Data shapes shared by the Electron main process and the React renderer.
// Every source (sample or real) returns these, so the UI never needs to know
// where the data came from.

export interface CalendarEvent {
  id: string;
  title: string;
  /** ISO 8601 timestamps. */
  start: string;
  end: string;
  location?: string;
  /** Video call link, if any. */
  meetingUrl?: string;
  calendar?: string;
  allDay?: boolean;
}

export interface EmailMessage {
  id: string;
  from: { name: string; email: string };
  subject: string;
  snippet: string;
  receivedAt: string;
  unread: boolean;
  /** True when the message likely needs a reply from you. Triage fills this in later. */
  needsReply?: boolean;
  url?: string;
}

export type TaskPriority = 'high' | 'medium' | 'low';

export interface Task {
  id: string;
  title: string;
  done: boolean;
  /** ISO date (YYYY-MM-DD) or timestamp. */
  due?: string;
  priority?: TaskPriority;
  project?: string;
  /** Where the task lives, e.g. "Todoist", "Quick capture". */
  source?: string;
}

export interface Weather {
  location: string;
  temperatureF: number;
  highF: number;
  lowF: number;
  condition: string;
  /** Short emoji or icon key for the condition. */
  icon: string;
  precipitationChance: number;
}

export interface Commute {
  destination: string;
  durationMinutes: number;
  mode: 'drive' | 'transit' | 'walk' | 'bike';
  /** When to leave to make the first in-person event, if there is one. */
  leaveBy?: string;
  summary?: string;
}

export interface Note {
  id: string;
  text: string;
  createdAt: string;
}

export interface SourceStatus {
  name: string;
  kind: 'sample' | 'live';
  ok: boolean;
  error?: string;
}

/** Everything the dashboard renders, fetched in one call. */
export interface DashboardSnapshot {
  generatedAt: string;
  events: CalendarEvent[];
  emails: EmailMessage[];
  tasks: Task[];
  weather: Weather | null;
  commute: Commute | null;
  notes: Note[];
  sources: SourceStatus[];
}

export interface CaptureInput {
  text: string;
  kind: 'task' | 'note';
}

/** The API the preload script exposes on `window.hub`. */
export interface HubApi {
  getSnapshot(): Promise<DashboardSnapshot>;
  refresh(): Promise<DashboardSnapshot>;
  setTaskDone(id: string, done: boolean): Promise<void>;
  capture(input: CaptureInput): Promise<void>;
  closeCapture(): void;
  openExternal(url: string): void;
  onSnapshot(listener: (snapshot: DashboardSnapshot) => void): () => void;
  platform: string;
  captureShortcut: string;
}
