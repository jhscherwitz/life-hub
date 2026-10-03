import type { PlacedWidget } from './layout';

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
  /**
   * From a person (not a newsletter or robot), in your Primary inbox, and not
   * answered yet. Triage looks only at these to decide what needs a reply.
   */
  replyCandidate?: boolean;
  /** True when the message needs a reply from you. Set by triage. */
  needsReply?: boolean;
  /** Why triage thinks it needs a reply, in a few words (AI only). */
  triageReason?: string;
  /** A draft reply Hub saved for this message, if any. */
  draft?: SavedDraft;
  url?: string;
}

export interface SavedDraft {
  /** The reply text. */
  body: string;
  /** True once it's saved in Gmail's Drafts; false for sample email. */
  savedToGmail: boolean;
  /** Where to open it. */
  url?: string;
  writtenBy: Writer;
  createdAt: string;
}

/** Who wrote a piece of text: the free AI, or Hub's simple built-in version. */
export type Writer = 'ai' | 'basic';

/** The AI's summary of the inbox, so you don't have to open Gmail. */
export interface InboxSummary {
  /** Two or three sentences about the whole inbox. */
  overview: string;
  /** One line per email, by email id. */
  items: Record<string, string>;
  generatedAt: string;
}

/** Which free AI Life Hub uses: off, a Google Gemini key, or Ollama on this computer. */
export type AiProvider = 'off' | 'gemini' | 'ollama';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
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
  /** When it was ticked off (ISO timestamp). */
  completedAt?: string;
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

export interface Briefing {
  /** Local date it's for, YYYY-MM-DD. */
  date: string;
  headline: string;
  points: string[];
  writtenBy: Writer;
  generatedAt: string;
  /** True while the AI is writing a fresh one (the basic briefing shows meanwhile). */
  writing?: boolean;
  /** Set when the AI couldn't write it, so the basic briefing is showing instead. */
  error?: string;
}

/** Something unfinished at the end of the day. */
export interface WrapUpItem {
  /** "task:<id>" or "email:<id>". */
  id: string;
  kind: 'task' | 'email';
  title: string;
  detail?: string;
}

/** What the evening wrap-up panel shows before you finish the day. */
export interface WrapUpPreview {
  date: string;
  done: string[];
  meetings: number;
  unfinished: WrapUpItem[];
}

/** A finished evening wrap-up. Its carry-over feeds the next morning's briefing. */
export interface WrapUp {
  date: string;
  finishedAt: string;
  done: string[];
  meetings: number;
  carryOver: WrapUpItem[];
  note?: string;
  summary: string;
  writtenBy: Writer;
}

/** Everything the dashboard renders, fetched in one call. */
export interface DashboardSnapshot {
  generatedAt: string;
  events: CalendarEvent[];
  emails: EmailMessage[];
  tasks: Task[];
  weather: Weather | null;
  notes: Note[];
  sources: SourceStatus[];
  briefing: Briefing;
  /** Today's wrap-up, once you've done it. */
  wrapUp: WrapUp | null;
  /** The last wrap-up before today, whose unfinished items carry into today. */
  carriedOver: WrapUp | null;
  ai: {
    /** Free AI is turned on in Settings, so it does the writing. */
    enabled: boolean;
    /** Drafts can be saved to Gmail (signed in, with permission to create drafts). */
    canSaveDrafts: boolean;
  };
}

export interface CaptureInput {
  text: string;
  kind: 'task' | 'note';
}

/** A place picked for the weather, from the Open-Meteo place search. */
export interface Place {
  name: string;
  /** e.g. "Illinois, United States". */
  region: string;
  latitude: number;
  longitude: number;
}

/** The automatic morning update. */
export interface MorningSettings {
  enabled: boolean;
  /** Local time, 24-hour "HH:MM". */
  time: string;
}

/** What the Settings panel shows. Secrets never leave the main process. */
export interface SettingsView {
  google: {
    /** True once a Client ID and secret have been saved. */
    hasCredentials: boolean;
    clientId?: string;
    /** True when Hub's built-in Google client is used, so there's nothing to paste. */
    builtIn: boolean;
    connected: boolean;
    email?: string;
    /** Set when sign-in expired or was revoked, so the user knows to sign in again. */
    error?: string;
    /** False when signed in from before Hub could save drafts: sign in again to allow it. */
    canSaveDrafts: boolean;
  };
  ai: {
    provider: AiProvider;
    /** The model in use, like gemini-2.5-flash or llama3.2. */
    model?: string;
  };
  weather: { place: Place | null };
  morning: MorningSettings & {
    /** When it last ran (ISO timestamp). */
    lastRunAt?: string;
  };
  startAtLogin: {
    enabled: boolean;
    /** False when running from the terminal (npm run dev): only the installed app can start at login. */
    available: boolean;
  };
  background: {
    /** True when the user picked their own picture. */
    custom: boolean;
    /** Changes whenever the picture does, so the dashboard knows to reload it. */
    version: number;
  };
}

/** A focus session started from the Now block. */
export interface FocusSession {
  /** What you're focusing on, usually the Now headline. */
  label: string;
  /** ISO timestamps. */
  startedAt: string;
  endsAt: string;
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
  /** Checks a free Gemini key with Google, then saves it encrypted. */
  connectGemini(key: string): Promise<SettingsView>;
  /** The models downloaded in Ollama on this computer. */
  listOllamaModels(): Promise<string[]>;
  useOllama(model: string): Promise<SettingsView>;
  turnOffAi(): Promise<SettingsView>;
  summarizeInbox(): Promise<InboxSummary>;
  chat(messages: ChatTurn[]): Promise<string>;
  setMorning(input: MorningSettings): Promise<SettingsView>;
  setStartAtLogin(enabled: boolean): Promise<SettingsView>;
  /** Run the morning update now: refresh, write the briefing, and notify. */
  runMorningNow(): Promise<SettingsView>;
  /** Ask the AI for a fresh briefing now. */
  rewriteBriefing(): Promise<void>;
  /** Write a reply to an email and save it as a Gmail draft. Never sends. */
  draftReply(emailId: string): Promise<SavedDraft>;
  previewWrapUp(): Promise<WrapUpPreview>;
  finishWrapUp(input: { carryOver: string[]; note: string }): Promise<WrapUp>;
  closeCapture(): void;
  openExternal(url: string): void;
  onSnapshot(listener: (snapshot: DashboardSnapshot) => void): () => void;
  /** The user's own background picture as a data: URL, or null for the built-in one. */
  getBackground(): Promise<string | null>;
  /** Opens a file picker; resolves with the new settings (unchanged if they cancel). */
  chooseBackground(): Promise<SettingsView>;
  resetBackground(): Promise<SettingsView>;
  getFocus(): Promise<FocusSession | null>;
  /** The widgets on the Today page, in order. */
  getLayout(): Promise<PlacedWidget[]>;
  saveLayout(layout: PlacedWidget[]): Promise<PlacedWidget[]>;
  startFocus(minutes: number, label: string): Promise<FocusSession>;
  stopFocus(): Promise<void>;
  onFocus(listener: (session: FocusSession | null) => void): () => void;
  platform: string;
  captureShortcut: string;
}
