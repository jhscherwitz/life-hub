import type { AlertPrefs } from './smartAlerts';
import type { Unsubscribe } from './unsubscribe';
import type { ActionResult, ChatReply } from './actions';
import type { CanvasData } from './canvas';
import type { Reminder } from './reminders';
import type { Countdown, Extras, GroceryItem } from './extras';
import type { NewsView } from './news';
import type { AdBlockState, BrowserDownload } from './browser';
import type { CommuteRoute, CommuteTime } from './commute';
import type { SportsView } from './sports';
import type { HabitsView } from './habits';
import type { EmailPlan } from './plans';
import type { Holding, PortfolioData } from './portfolio';
import type { PlacedWidget } from './layout';
import type { HourlyWeather, WeatherKind } from './weather';
import type { MusicLibrary, SongInfo } from './media';
import type { NowPlaying, NowPlayingCommand } from './nowplaying';
import type { ToolStep } from './tools';
import type { InboxDigest, InboxRange, MailRule } from './inbox';
import type { Bookmark, BrowserSession, PasswordPrompt, Suggestion } from './browser';

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
  /** The calendar's colour, from Google Calendar. */
  color?: string;
  allDay?: boolean;
  /** "calendarId|eventId", so it can be moved or cancelled. Only on events you can change. */
  ref?: string;
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
  /** The Gmail conversation it's in (archive, delete and star act on the whole conversation). */
  threadId?: string;
  starred?: boolean;
  /** How to unsubscribe, when it's a newsletter that says. */
  unsubscribe?: Unsubscribe;
}

/** Things you can do to an email from Life Hub. Delete moves it to Trash, like Gmail does. */
export const MAIL_CHANGES = ['archive', 'unarchive', 'trash', 'untrash', 'star', 'unstar', 'read', 'unread'] as const;
export type MailChange = (typeof MAIL_CHANGES)[number];

/** What undoes each change. */
export const MAIL_UNDO: Record<MailChange, MailChange> = {
  archive: 'unarchive',
  unarchive: 'archive',
  trash: 'untrash',
  untrash: 'trash',
  star: 'unstar',
  unstar: 'star',
  read: 'unread',
  unread: 'read',
};

export interface SavedDraft {
  /** The reply text. */
  body: string;
  /** Gmail's id for the draft, so it can be deleted (Undo). */
  id?: string;
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

export interface BrowserAsk {
  kind: 'ask' | 'explain';
  text: string;
  url: string;
  title: string;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  /** What the AI did for this reply (added a task, set a reminder…). */
  actions?: ActionResult[];
  /** Pictures attached to this message, as data: URLs. */
  images?: string[];
  /** What the AI looked up before answering (searched the web…). */
  steps?: ToolStep[];
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
  /** The picture to draw. Missing from older versions. */
  kind?: WeatherKind;
  feelsLikeF?: number;
  windMph?: number;
  /** Relative humidity, 0-100. */
  humidity?: number;
  /** Today's highest UV index. */
  uvMax?: number;
  /** ISO times. */
  sunrise?: string;
  sunset?: string;
  /** Hour by hour from the start of today, for the charts. */
  hourly?: HourlyWeather[];
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
  /** Plans with a date the AI found in your email that aren't on your calendar. */
  plans?: EmailPlan[];
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
    /** False when signed in from before Hub could add calendar events. */
    canAddEvents?: boolean;
    /** False when signed in from before Hub could archive, delete and star email. */
    canChangeMail?: boolean;
    /** Tasks are kept in step with Google Tasks. */
    tasksSync?: boolean;
  };
  ai: {
    provider: AiProvider;
    /** The model in use, like gemini-2.5-flash or llama3.2. */
    model?: string;
    /** The free backup AI used when the main one runs out. */
    backup?: { provider: 'groq' | 'openrouter'; label: string };
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
  /** Missing from older versions. */
  /** signedIn: connected by signing in to Canvas inside Life Hub, not with an access token. */
  canvas?: { connected: boolean; origin?: string; signedIn?: boolean };
  /** Missing from older versions. */
  theme?: ThemeName;
  /** Who's using Life Hub, and whether first-run setup is done. */
  profile?: { name: string; setupDone: boolean };
  /** Phone reminders through ntfy. Missing from older versions. */
  phone?: { on: boolean; topic?: string };
  /** Which alerts are on. Missing from older versions. */
  alerts?: AlertPrefs;
  background: {
    /** True when the user picked their own picture. */
    custom: boolean;
    /** Changes whenever the picture does, so the dashboard knows to reload it. */
    version: number;
    /** How blurry it is, in pixels (0 = sharp). Missing from older versions (30). */
    blur?: number;
  };
}

/** Accent colours to pick from. Purple is the default. */
export const THEMES = [
  { id: 'purple', name: 'Purple', color: '#3e0080', light: '#bd80ff' },
  { id: 'ocean', name: 'Ocean', color: '#00468c', light: '#6ec8ff' },
  { id: 'forest', name: 'Forest', color: '#005a3c', light: '#78e6aa' },
  { id: 'ember', name: 'Ember', color: '#8c1e14', light: '#ff966e' },
  { id: 'rose', name: 'Rose', color: '#6b0f3c', light: '#ff8cc6' },
  { id: 'graphite', name: 'Graphite', color: '#2c3242', light: '#c7d0e2' },
] as const;

export type ThemeName = (typeof THEMES)[number]['id'];

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
  /** Saves a free backup AI key (checked first), or removes it with null. */
  setBackupAi?(provider: 'groq' | 'openrouter' | null, key?: string): Promise<SettingsView>;
  summarizeInbox(): Promise<InboxSummary>;
  /** The Inbox page: emails from a stretch of days, sorted into look into / probably delete. */
  inboxDigest(range: InboxRange): Promise<InboxDigest>;
  chat(messages: ChatTurn[]): Promise<string>;
  setMorning(input: MorningSettings): Promise<SettingsView>;
  setStartAtLogin(enabled: boolean): Promise<SettingsView>;
  /** Run the morning update now: refresh, write the briefing, and notify. */
  runMorningNow(): Promise<SettingsView>;
  /** Ask the AI for a fresh briefing now. */
  rewriteBriefing(): Promise<void>;
  /** Searches the whole mailbox and about a year of calendar (when signed in). */
  search(query: string): Promise<{ emails: EmailMessage[]; events: CalendarEvent[] }>;
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
  /** The widgets on the Today page, in order. */
  getLayout(): Promise<PlacedWidget[]>;
  saveLayout(layout: PlacedWidget[]): Promise<PlacedWidget[]>;
  /** The song on a radio station right now, or null if unknown. */
  stationNowPlaying(stationId: string): Promise<SongInfo | null>;
  /** What's playing anywhere on the computer (Windows only; elsewhere supported is false). */
  getNowPlaying(): Promise<{ supported: boolean; state: NowPlaying }>;
  nowPlayingCommand(cmd: NowPlayingCommand): Promise<void>;
  onNowPlaying(listener: (np: NowPlaying) => void): () => void;
  getMusicLibrary(): Promise<MusicLibrary>;
  /** Opens a folder picker; resolves with the library (unchanged if they cancel). */
  chooseMusicFolder(): Promise<MusicLibrary>;
  forgetMusicFolder(): Promise<MusicLibrary>;
  /** Canvas classes, grades and upcoming work, or null when Canvas isn't connected. */
  getCanvas(force?: boolean): Promise<CanvasData | null>;
  /** Checks the address and token with Canvas, then saves the token encrypted. */
  connectCanvas(address: string, token: string): Promise<SettingsView>;
  disconnectCanvas(): Promise<SettingsView>;
  /** Opens the school's Canvas sign-in page; resolves once signed in. For schools that turned access tokens off. */
  signInToCanvas(address: string): Promise<SettingsView>;
  setTheme(theme: ThemeName): Promise<SettingsView>;
  /** How blurry the background picture is, 0 (sharp) to 60 pixels. */
  setBackgroundBlur(px: number): Promise<SettingsView>;
  /** Saves their name, or marks first-run setup done. */
  setProfile(input: { name?: string; setupDone?: boolean }): Promise<SettingsView>;
  /** Saves a backup file (no passwords or sign-ins). False if you cancelled. */
  exportBackup(): Promise<boolean>;
  /** Restores a backup file, then Life Hub restarts. False if you cancelled. */
  importBackup(): Promise<boolean>;
  /** Opens a filled-in GitHub issue in the browser. Nothing is sent unless you submit it there. */
  reportProblem(report: { message: string; stack?: string; where?: string }): void;
  /** Chat that can add tasks, countdowns, notes and reminders, and tick off daily tasks. */
  /** Stops the answer being written (the Stop button); what's written so far is kept. */
  chatStop?(): Promise<void>;
  chatAct(messages: ChatTurn[]): Promise<ChatReply>;
  /** Archive, delete, star or mark an email (its whole conversation). */
  changeMail(threadId: string, change: MailChange): Promise<void>;
  /** Unsubscribes from a newsletter: "done" right here, or its page (or Gmail) was opened. */
  unsubscribe?(id: string): Promise<{ how: 'done' | 'opened' | 'gmail'; from: string }>;
  /** Your Inbox sorting rules and what the AI remembers about you (saved on this computer). */
  getPrefs(): Promise<{ rules: MailRule[]; memories: { id: string; text: string; at: string }[] }>;
  removeRule(id: string): Promise<void>;
  forgetMemory(id: string): Promise<void>;
  /** Calendar events between two times (ISO), for the Calendar page's month, week and day views. */
  getEvents(startIso: string, endIso: string): Promise<CalendarEvent[]>;
  /** The browser tab you're looking at (its page's id), so the AI can use it. */
  browserActive(id: number | null): Promise<void>;
  /** The ad blocker for a page: on or off, allowed on this site, and how much it blocked. */
  browserAdBlock?(pageId: number | null, url: string): Promise<AdBlockState>;
  browserAdBlockOn?(on: boolean): Promise<AdBlockState>;
  browserAdBlockAllow?(url: string, allowed: boolean): Promise<void>;
  onBrowserBlocked?(listener: (b: { pageId: number; blocked: number }) => void): () => void;
  /** Downloads saving to the Downloads folder: progress, then done or failed. */
  onBrowserDownload?(listener: (d: BrowserDownload) => void): () => void;
  browserOpenDownload?(id: string, how: 'open' | 'folder'): Promise<void>;
  /** A page asked for a new tab (a link that opens a new window), or the AI opened a site. */
  onBrowserNewTab(listener: (url: string) => void): () => void;
  /** "Ask AI" or "Explain" on highlighted text in the browser. */
  onBrowserAsk(listener: (ask: BrowserAsk) => void): () => void;
  /** Suggestions from history and bookmarks for the address bar. */
  browserSuggest(typed: string): Promise<Suggestion[]>;
  browserBookmarks(): Promise<Bookmark[]>;
  /** Stars a page, or un-stars it. */
  browserToggleBookmark(url: string, title: string): Promise<Bookmark[]>;
  /** Pins a page to the top of the tabs, or unpins it. */
  browserPin(url: string, title: string, pinned: boolean): Promise<Bookmark[]>;
  browserRemoveBookmark(url: string): Promise<Bookmark[]>;
  /** Copies bookmarks from Chrome or Edge on this computer. */
  browserImportBookmarks(): Promise<{ added: number; bookmarks: Bookmark[] }>;
  browserClearHistory(): Promise<void>;
  /** The tabs open last time. */
  browserSession(): Promise<BrowserSession>;
  browserSaveSession(session: BrowserSession): Promise<void>;
  /** "Save password?" after signing in on a page. */
  onBrowserPasswordPrompt(listener: (prompt: PasswordPrompt) => void): () => void;
  browserPasswordAnswer(id: string, answer: 'save' | 'never' | 'no'): Promise<void>;
  /** A browser shortcut pressed while a page had focus: t, w, l, r, back, forward. */
  onBrowserKey(listener: (key: string) => void): () => void;
  /** What the AI is looking up while it works on an answer. */
  /** Each bit of the AI's answer as it's written. */
  onChatDelta?(listener: (delta: string) => void): () => void;
  onChatStep(listener: (step: ToolStep & { running?: boolean }) => void): () => void;
  undoAction(token: string): Promise<void>;
  getReminders(): Promise<Reminder[]>;
  /** "call mom at 6pm": reads the time out of the words. */
  addReminder(text: string): Promise<Reminder[]>;
  removeReminder(id: string): Promise<Reminder[]>;
  onReminders(listener: () => void): () => void;
  /** Chat changed the dashboard's widgets. */
  onLayoutChanged?(listener: () => void): () => void;
  /** Phone reminders: makes a private topic to subscribe to in the free ntfy app. */
  phoneOn(): Promise<SettingsView>;
  phoneOff(): Promise<SettingsView>;
  /** Turns Google Tasks sync on (asking Google for permission the first time) or off. */
  setGoogleTasks?(on: boolean): Promise<SettingsView>;
  /** Turns alerts on or off. */
  setAlerts?(prefs: Partial<AlertPrefs>): Promise<SettingsView>;
  phoneTest(): Promise<void>;
  /** Countdowns and the sticky note. */
  getExtras(): Promise<Extras>;
  setCountdowns(list: Countdown[]): Promise<Extras>;
  setNote(text: string): Promise<Extras>;
  setGroceries(list: GroceryItem[]): Promise<Extras>;
  /** Tells you when the AI changed the grocery list (or countdowns). */
  onExtras(listener: () => void): () => void;
  /** Today's top stories, with big ones marked. Cached for 20 minutes unless forced. */
  getNews(force?: boolean): Promise<NewsView>;
  /** Speech to text: a recording (base64) to the words said, using free Gemini. */
  transcribe(mime: string, data: string): Promise<string>;
  /** Asks for the microphone where the system needs it (macOS). True if allowed. */
  askMic(): Promise<boolean>;
  /** Words from speech to text as they're written down. */
  onTranscribeDelta?(listener: (delta: string) => void): () => void;
  /** Saves the Commute widget's trip (or clears it with null). */
  setCommute(route: CommuteRoute | null): Promise<Extras>;
  /** Drive time between two addresses, from free OpenStreetMap routing. */
  commuteTime(from: string, to: string): Promise<CommuteTime>;
  setSports(leagues: string[]): Promise<Extras>;
  /** Recent games in the leagues you follow. */
  getScores(): Promise<SportsView>;
  /** Stocks and crypto you typed in, with free live prices. */
  getPortfolio(force?: boolean): Promise<PortfolioData>;
  /** Checks the ticker has a price, then adds it (or updates the share count). */
  addHolding(symbol: string, shares: number): Promise<PortfolioData>;
  setHoldings(list: Holding[]): Promise<PortfolioData>;
  hidePortfolio(hidden: boolean): Promise<PortfolioData>;
  /** Called when Chat changes the stocks they own. */
  onPortfolio(listener: () => void): () => void;
  /** Daily tasks: the same list every day, ticked off and reset at midnight. */
  getHabits(): Promise<HabitsView>;
  toggleHabit(id: string): Promise<HabitsView>;
  addHabit(title: string): Promise<HabitsView>;
  renameHabit(id: string, title: string): Promise<HabitsView>;
  removeHabit(id: string): Promise<HabitsView>;
  platform: string;
  captureShortcut: string;
}
