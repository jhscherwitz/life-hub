// Everything the AI can look up or do, as functions it calls one step at a
// time (Gemini's own function calling). It sees each result before it goes
// on, so it can chain steps and never claims something worked when it didn't.
import { ACTION_TYPES, cleanActions, type ActionType, type ChatAction } from '../../src/shared/actions';
import { RULE_PILES } from '../../src/shared/inbox';
import { STOCK_RANGES, TOOL_NAMES, cleanToolCalls, type ToolCall, type ToolName } from '../../src/shared/tools';
import { MAIL_CHANGES } from '../../src/shared/types';
import type { AgentFunction } from '../ai/types';

const S = (description: string) => ({ type: 'STRING', description });
const N = (description: string) => ({ type: 'NUMBER', description });
const B = (description: string) => ({ type: 'BOOLEAN', description });
const E = (values: readonly string[], description: string) => ({ type: 'STRING', enum: [...values], description });
const params = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'OBJECT', properties, ...(required.length && { required }) });

const TOOLS: Record<ToolName, Omit<AgentFunction, 'name'>> = {
  web_search: {
    description: 'Search the web for anything current or factual: news, scores, prices, schedules, how-tos, people, places. Never say you can’t look something up; search.',
    parameters: params({ query: S('Good search words.') }, ['query']),
  },
  read_page: { description: 'Read a web page in full (from search results or a link they gave).', parameters: params({ url: S('The page address.') }, ['url']) },
  stock_history: {
    description: "Any ticker's price over a stretch of time.",
    parameters: params({ symbols: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Tickers like AAPL, VOO, BTC-USD.' }, range: E(STOCK_RANGES, 'ytd = this year so far.') }, ['symbols']),
  },
  portfolio_history: {
    description: 'How the stocks they own did over a range, in dollars and percent. Use for "how are my stocks this year/month".',
    parameters: params({ range: E(STOCK_RANGES, 'ytd = this year so far.') }),
  },
  search_email: {
    description: 'Search all their Gmail. Gmail search words work: from:, to:, subject:, older_than:, has:attachment. Returns ids for read_email, reply and email.',
    parameters: params({ query: S('The search words.') }, ['query']),
  },
  read_email: { description: 'Read one email in full.', parameters: params({ id: S('Its id, from the inbox list or search_email.') }, ['id']) },
  search_calendar: { description: 'Find events in their Google Calendar, from about a year back to a year ahead.', parameters: params({ query: S('Words in the event.') }, ['query']) },
  calendar_days: {
    description: 'Everything on their calendar for a day or a stretch of days ("what\'s on Friday", "my week", "next weekend"). Work out the date yourself from today.',
    parameters: params({ start: S('The first day, as YYYY-MM-DD.'), days: N('How many days (1 for one day, 7 for a week; at most 31).') }, ['start']),
  },
  top_news: { description: "Today's top news stories (Google News), with big ones marked. Use for \"what's in the news\"; then web_search or read_page for detail." },
  browser_read: {
    description: 'Read the page open in Life Hub’s browser: its words, and numbered links, buttons and boxes. Use for "this page", "this article", "summarize this".',
  },
  browser_open: { description: 'Open a site in their browser, like a person would.', parameters: params({ url: S('The address, starting with https://.'), new_tab: B('True to keep their current page.') }, ['url']) },
  browser_click: { description: 'Click a numbered thing from browser_read. Read the page again afterwards; numbers change.', parameters: params({ id: S('Its number.') }, ['id']) },
  browser_type: {
    description: 'Type into a numbered box from browser_read. For a dropdown, text = the option.',
    parameters: params({ id: S('Its number.'), text: S('What to type.'), submit: B('True to press Enter (like searching).') }, ['id', 'text']),
  },
  browser_scroll: { description: 'Scroll their browser page.', parameters: params({ direction: E(['up', 'down', 'top', 'bottom'], 'Which way.') }, ['direction']) },
  browser_back: { description: 'Go back a page in their browser.' },
  spotify: {
    description:
      'Control their Spotify (they have Premium): play a song, playlist, album or artist ("play my gym playlist", "play some Drake"), pause, resume, skip (next), go back (previous), say what is playing (now), like the current song (like), or list their playlists. Their own playlists are checked first.',
    parameters: params(
      {
        command: E(['play', 'pause', 'resume', 'next', 'previous', 'now', 'like', 'playlists'], 'What to do.'),
        query: S('For play: what to play, in their words ("my gym playlist", "Blinding Lights", "Drake").'),
        kind: E(['track', 'playlist', 'album', 'artist'], 'For play: what kind of thing it is, if clear. Leave out for a song.'),
      },
      ['command'],
    ),
  },
  find_files: {
    description: 'Find files on their computer (Documents, Downloads, Desktop) by words in the file name, newest first. Use for "my syllabus", "the PDF I downloaded", "my resume".',
    parameters: params({ query: S('Words in the file name, like "bio syllabus" or "resume".') }, ['query']),
  },
  read_file: {
    description: 'Read a file found with find_files: text, PDF or picture. Use it to answer from a syllabus, notes or a document; to turn due dates into tasks, add one add_task per date.',
    parameters: params({ id: S('The full path from find_files.') }, ['id']),
  },
  read_attachment: {
    description: 'Read a file attached to an email (read_email lists them): a syllabus PDF, a schedule, a picture.',
    parameters: params({ id: S("The email's id."), query: S("The attachment's file name, as read_email listed it.") }, ['id', 'query']),
  },
  search_drive: {
    description: 'Search their Google Drive (Docs, Sheets, Slides, PDFs) by words in the name or inside the file.',
    parameters: params({ query: S('The search words.') }, ['query']),
  },
  read_drive: { description: 'Read a Google Drive file from search_drive.', parameters: params({ id: S("The file's id.") }, ['id']) },
};

const when = S('When, in plain words exactly as they said it ("friday 3pm", "tomorrow", "nov 12", "in 20 minutes"). Never convert it yourself.');

const ACTIONS: Record<ActionType, Omit<AgentFunction, 'name'>> = {
  add_task: { description: 'Add a to-do (homework, a chore, something to get done). Not for groceries or calendar plans.', parameters: params({ title: S('The task.'), when }, ['title']) },
  add_event: {
    description: 'Put something on their Google Calendar (plans, hangouts, appointments, games, anything happening at a time). Use this, not add_task, for plans; never both. With no time it goes in as all day.',
    parameters: params({ title: S('The event.'), when, minutes: N('How long, if they said (default 60).'), place: S('Where, if they said.') }, ['title', 'when']),
  },
  reply: {
    description: 'Reply to an email they got. Life Hub writes it properly and saves it as a Gmail draft for them to check and send (you never send).',
    parameters: params({ title: S("The email's id."), text: S('What they want to say, in their words, with every detail they gave.') }, ['title', 'text']),
  },
  new_email: {
    description:
      'Write a NEW email (not a reply) to an address. Life Hub writes it properly (clear subject, greeting, the right tone for a professor or a friend, sign-off) and saves it as a Gmail draft for them to send (you never send). If they only gave a name, find the address with search_email first.',
    parameters: params({ title: S('The email address.'), text: S('What they want to say, in their words, with every detail they gave.'), subject: S('A short subject idea, if obvious.') }, ['title', 'text']),
  },
  email: {
    description: 'Archive, delete (to Trash; can be undone), star or mark an email. One call per email; you can call it many times (like archiving every newsletter). Only trash what they clearly want gone.',
    parameters: params({ title: S("The email's id."), change: E(MAIL_CHANGES, 'What to do.') }, ['title', 'change']),
  },
  mail_rule: {
    description: 'A lasting rule for sorting their Inbox page (you sort it into Look into, Archive and Probably delete). Use when they say "from now on", "always", "stop deleting", "keep" about kinds of email.',
    parameters: params({ title: S('A sender name, address, domain or subject words.'), pile: E(RULE_PILES, 'keep = never archive or delete it.') }, ['title', 'pile']),
  },
  remove_rule: { description: 'Drop an Inbox sorting rule.', parameters: params({ title: S('What it matched.') }, ['title']) },
  remember: {
    description: 'Remember something about them for every future chat ("I am a junior", "call me Jake"). Use whenever they say remember or from now on, or tell you something lasting about themselves.',
    parameters: params({ title: S('The fact, in their words.') }, ['title']),
  },
  forget: { description: 'Forget something you remembered.', parameters: params({ title: S('Words from it.') }, ['title']) },
  add_countdown: { description: 'Count down to a day (exam, trip, birthday).', parameters: params({ title: S('What.'), when }, ['title', 'when']) },
  add_grocery: { description: 'Put one item on their grocery list. Call once per item. Use for things to buy at the store, not add_task.', parameters: params({ title: S('One item, with an amount if they said ("2 avocados").') }, ['title']) },
  add_note: { description: 'Save a note.', parameters: params({ title: S('The note.') }, ['title']) },
  tick_habit: { description: 'Mark one of their daily tasks done.', parameters: params({ title: S('Its name.') }, ['title']) },
  remind: { description: 'A reminder notification at a time, on this computer and their phone.', parameters: params({ title: S('What to remind them.'), when }, ['title', 'when']) },
  set_holding: {
    description: 'Record stocks or crypto they own. If they bought or sold some, add to or take away from what they already own.',
    parameters: params({ title: S('The ticker (AAPL, VOO, BTC).'), shares: N('How many they own NOW in total; 0 if they sold it all.') }, ['title', 'shares']),
  },
  remove_holding: { description: 'Stop tracking a stock.', parameters: params({ title: S('The ticker.') }, ['title']) },
  arrange_widgets: {
    description:
      'Rearrange the widgets on their dashboard (the Today page) when they ask you to do it. The ones you list go first, in that order, and are added if missing; the rest stay after them. Nothing is removed. They can undo it.',
    parameters: params({ title: S('Widget names in the order they should go, separated by commas, like "timeline, tasks, weather, news". Use the names or ids from their dashboard list.') }, ['title']),
  },
  unsubscribe: {
    description: 'Unsubscribe them from a newsletter or mailing list when they ask ("unsubscribe me from these"). Only for emails marked (can unsubscribe). One call per email.',
    parameters: params({ title: S("The email's id.") }, ['title']),
  },
  move_event: {
    description:
      'Move an event on their calendar to a new time (also when an email says something moved, like "the exam moved to Thursday", and they want it changed). Keeps its length unless they gave one. They can undo it.',
    parameters: params({ title: S('The event: its [event …] ref from the calendar list or a look-up, or its name.'), when, minutes: N('New length in minutes, only if they said.') }, ['title', 'when']),
  },
  cancel_event: {
    description: 'Cancel (delete) an event on their calendar when they clearly ask. Events with other people in them can only be cancelled in Google Calendar. They can undo it.',
    parameters: params({ title: S('The event: its [event …] ref, or its name.') }, ['title']),
  },
  remove_widget: { description: 'Take a widget off their dashboard.', parameters: params({ title: S('The widget, by name or id.') }, ['title']) },
};

/** The functions to offer: actions always, look-ups when Life Hub can run them. */
export function agentFunctions(withTools: boolean): AgentFunction[] {
  const actions = ACTION_TYPES.map((name) => ({ name, ...ACTIONS[name] }));
  return withTools ? [...TOOL_NAMES.map((name) => ({ name, ...TOOLS[name] })), ...actions] : actions;
}

/** Reads a function call into a look-up or an action Life Hub knows, checked like the old way. */
export function readCall(name: string, args: Record<string, unknown>): { tool: ToolCall } | { action: ChatAction } | null {
  if ((TOOL_NAMES as readonly string[]).includes(name)) {
    const [tool] = cleanToolCalls([{ ...args, name }]);
    return tool ? { tool } : null;
  }
  if ((ACTION_TYPES as readonly string[]).includes(name)) {
    const [action] = cleanActions([{ ...args, type: name, title: args.title ?? '' }]);
    return action ? { action } : null;
  }
  return null;
}
