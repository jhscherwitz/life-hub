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
  /** Where the task lives, e.g. "Hub". */
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

export type CommuteMode = 'drive' | 'walk' | 'bike';

/** A place picked for the weather, from the Open-Meteo place search. */
export interface Place {
  name: string;
  /** e.g. "Illinois, United States". */
  region: string;
  latitude: number;
  longitude: number;
}

/** What the Settings panel shows. Secrets never leave the main process. */
export interface SettingsView {
  google: {
    /** True once a Client ID and secret have been saved. */
    hasCredentials: boolean;
    clientId?: string;
    connected: boolean;
    email?: string;
    /** Set when sign-in expired or was revoked, so the user knows to sign in again. */
    error?: string;
  };
  weather: { place: Place | null };
  commute: { homeAddress: string; mode: CommuteMode };
}

/** The API the preload script exposes on `window.hub`. */
export interface HubApi {
  getSnapshot(): Promise<DashboardSnapshot>;
  refresh(): Promise<DashboardSnapshot>;
  setTaskDone(id: string, done: boolean): Promise<void>;
  addTask(title: string): Promise<void>;
  removeTask(id: string): Promise<void>;
  capture(input: CaptureInput): Promise<void>;
  getSettings(): Promise<SettingsView>;
  saveGoogleCredentials(input: { clientId: string; clientSecret: string }): Promise<SettingsView>;
  /** Opens Google sign-in in the browser and resolves once it's finished. */
  googleSignIn(): Promise<SettingsView>;
  googleSignOut(): Promise<SettingsView>;
  searchPlaces(query: string): Promise<Place[]>;
  setWeatherPlace(place: Place | null): Promise<SettingsView>;
  setCommute(input: { homeAddress: string; mode: CommuteMode }): Promise<SettingsView>;
  closeCapture(): void;
  openExternal(url: string): void;
  onSnapshot(listener: (snapshot: DashboardSnapshot) => void): () => void;
  platform: string;
  captureShortcut: string;
}
