import { formatTime, isSameDay } from '../../src/shared/time';
import type { CalendarEvent } from '../../src/shared/types';
import type { EmailDetail } from '../sources/types';
import type { AiWriter } from '../ai/types';

function firstName(name: string, email: string): string {
  const first = name.includes('@') ? '' : name.split(/[\s,]+/)[0];
  return first || email.split('@')[0];
}

/** Without AI: a ready-to-finish reply with the greeting and sign-off in place. */
export function basicDraft(original: EmailDetail): string {
  return `Hi ${firstName(original.from.name, original.from.email)},\n\nThanks for your email. \n\nBest,\nJacob`;
}

const SYSTEM = `You draft email replies for Jacob. The draft is saved in his Gmail Drafts for him to check and send himself.

Write only the body of the reply, as plain text: no subject line, no quoted original. Match the sender's tone and length, and keep it short. Open with a greeting using the sender's first name and end with a short sign-off from "Jacob".

Answer what you can from the email and his calendar. Never make up facts, commitments, prices or dates: where the reply needs something only Jacob knows or decides, leave a short placeholder in square brackets, like [time that works].`;

const SCHEMA = {
  type: 'object',
  properties: { body: { type: 'string' } },
  required: ['body'],
  additionalProperties: false,
};

/** The AI's reply to an email, using today's and tomorrow's calendar for context. */
export async function writeDraft(writer: AiWriter, original: EmailDetail, events: CalendarEvent[], now = new Date(), instructions?: string): Promise<string> {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const calendar = events
    .filter((e) => isSameDay(e.start, now) || isSameDay(e.start, tomorrow))
    .map((e) => `- ${isSameDay(e.start, now) ? 'Today' : 'Tomorrow'} ${e.allDay ? 'all day' : formatTime(e.start)}: ${e.title}`)
    .join('\n');
  const { body } = await writer.json<{ body: string }>({
    system: SYSTEM,
    prompt: [
      `Today is ${now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}.`,
      `Jacob's calendar:\n${calendar || '- nothing scheduled'}`,
      `The email to reply to:\nFrom: ${original.from.name} <${original.from.email}>\nSubject: ${original.subject}\n\n${original.body}`,
      ...(instructions?.trim()
        ? [`What Jacob wants to say (say this, in his voice; don't add promises, times or facts he didn't give):\n${instructions.trim()}`]
        : []),
    ].join('\n\n'),
    schema: SCHEMA,
    effort: 'medium',
  });
  if (!body?.trim()) throw new Error('The AI\'s draft came back empty. Try again.');
  return body.trim();
}
