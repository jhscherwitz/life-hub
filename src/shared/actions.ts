import { RULE_PILES, type RulePile } from './inbox';
import { MAIL_CHANGES, type MailChange } from './types';
import type { ToolStep } from './tools';

// Things the AI in Chat can do, not just say: add a task, a countdown or a
// note, tick off a daily task, or update the stocks they own. The AI names the action and gives the date
// in plain words; Life Hub works out the real date itself (see when.ts).

export const ACTION_TYPES = ['add_task', 'add_event', 'reply', 'email', 'mail_rule', 'remove_rule', 'remember', 'forget', 'add_countdown', 'add_grocery', 'add_note', 'tick_habit', 'remind', 'set_holding', 'remove_holding'] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

/** One action as the AI asks for it. */
export interface ChatAction {
  type: ActionType;
  /** The task, countdown, note or reminder text, the daily task's name, or a ticker. */
  title: string;
  /** When, in plain words ("friday 3pm", "nov 12", "2026-11-12"), if it has a time. */
  when?: string;
  /** For set_holding: how many shares they own now, in total. */
  shares?: number;
  /** For reply: what they want to say. */
  text?: string;
  /** For mail_rule: where matching email goes. */
  pile?: RulePile;
  /** For email: what to do to it (title is the email's id). */
  change?: MailChange;
  /** For add_event: how long, and where. */
  minutes?: number;
  place?: string;
}

/** What was actually done, shown as a card under the reply. */
export interface ActionResult {
  type: ActionType;
  /** "Added task", "Countdown", "Ticked off"… */
  label: string;
  /** The thing itself, with its date if it has one. */
  detail: string;
  ok: boolean;
  /** Passed back to undo it. Missing when it can't be undone (or didn't happen). */
  undo?: string;
  /** Set on screen once Undo was clicked. */
  undone?: boolean;
  /** For a reply: the draft's text, and where to open it. */
  body?: string;
  url?: string;
}

export interface ChatReply {
  reply: string;
  actions: ActionResult[];
  /** What it looked up first. */
  steps?: ToolStep[];
}

/** Enough to tidy a page of email in one go. */
const MAX_ACTIONS = 25;

/** Keeps only well-formed actions from the AI's answer, at most six. */
export function cleanActions(raw: unknown): ChatAction[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatAction[] = [];
  for (const item of raw) {
    const a = item as Partial<ChatAction> | null;
    if (!a || !ACTION_TYPES.includes(a.type as ActionType) || typeof a.title !== 'string' || !a.title.trim()) continue;
    out.push({
      type: a.type as ActionType,
      title: a.title.trim().slice(0, 200),
      ...(typeof a.when === 'string' && a.when.trim() && { when: a.when.trim().slice(0, 60) }),
      ...(typeof a.shares === 'number' && Number.isFinite(a.shares) && { shares: a.shares }),
      ...(typeof a.minutes === 'number' && a.minutes > 0 && a.minutes <= 1440 && { minutes: Math.round(a.minutes) }),
      ...(MAIL_CHANGES.includes(a.change as MailChange) && { change: a.change }),
      ...(RULE_PILES.includes(a.pile as RulePile) && { pile: a.pile }),
      ...(typeof a.text === 'string' && a.text.trim() && { text: a.text.trim().slice(0, 2000) }),
      ...(typeof a.place === 'string' && a.place.trim() && { place: a.place.trim().slice(0, 200) }),
    });
  }
  return out.slice(0, MAX_ACTIONS);
}

/** The JSON shape the AI answers in. */
export const CHAT_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: [...ACTION_TYPES] },
          title: { type: 'string' },
          when: { type: 'string' },
          shares: { type: 'number' },
          minutes: { type: 'number' },
          change: { type: 'string', enum: [...MAIL_CHANGES] },
          pile: { type: 'string', enum: [...RULE_PILES] },
          text: { type: 'string' },
          place: { type: 'string' },
        },
        required: ['type', 'title'],
      },
    },
  },
  required: ['reply', 'actions'],
};
