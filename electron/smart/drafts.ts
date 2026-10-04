import { person, persons, signOff } from './person';
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
  return `Hi ${firstName(original.from.name, original.from.email)},\n\nThanks for your email. \n\nBest,${signOff() ? `\n${signOff()}` : ''}`;
}

const system = () => `You draft email replies for ${person()}. The draft is saved in their Gmail Drafts for them to check and send themselves.

Write only the body of the reply, as plain text: no subject line, no quoted original. Match the sender's tone and length, and keep it short. Open with a greeting using the sender's first name and end with a short sign-off${signOff() ? ` from "${signOff()}"` : ' (no name)'}.

Answer what you can from the email and their calendar. Never make up facts, commitments, prices or dates: where the reply needs something only they know or decide, leave a short placeholder in square brackets, like [time that works].`;

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
    system: system(),
    prompt: [
      `Today is ${now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}.`,
      `${persons()} calendar:\n${calendar || '- nothing scheduled'}`,
      `The email to reply to:\nFrom: ${original.from.name} <${original.from.email}>\nSubject: ${original.subject}\n\n${original.body}`,
      ...(instructions?.trim()
        ? [`What ${person()} wants to say (say this, in their voice; don't add promises, times or facts they didn't give):\n${instructions.trim()}`]
        : []),
    ].join('\n\n'),
    schema: SCHEMA,
    effort: 'medium',
  });
  if (!body?.trim()) throw new Error('The AI\'s draft came back empty. Try again.');
  return body.trim();
}
