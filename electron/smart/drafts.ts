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

/** Earlier email with the person a new email goes to, so it gets their name and the right tone. */
export interface PastEmail {
  from: string;
  subject: string;
  snippet: string;
  date: string;
}

const newSystem = () => `You write emails for ${person()}. The email is saved in their Gmail Drafts for them to check and send themselves, so it must be ready to send as is.

Write it properly, like a thoughtful person would:
- Subject: specific and useful, saying what the email is about in a few words ("Question about the Module 2 test", "Can you help me bake cookies?"). Never one vague word, never exclamation marks, no "Re:".
- Greeting: use their name if you know it from past emails or what ${person()} said. Match how formal the relationship is. A professor, teacher, boss, coach or anyone at a school or company address: formal ("Dear Professor Ramirez," or "Hi Dr. Lee,"), complete sentences, polite, no slang, and say briefly who ${person()} is if they haven't emailed before (for a professor, mention the class if known). A friend or family member: casual and warm ("Hey Angel,"), but still clear.
- Body: say what ${person()} wants to say, clearly and briefly, in their voice. Turn their quick words into good writing: fix spelling and grammar, drop text-speak. Don't add facts, promises, times or details they didn't give; where something important is missing, put a short placeholder in square brackets, like [class name].
- Sign-off: fitting the tone ("Best," / "Thank you," for formal, "Thanks!" or "See you soon," for casual)${signOff() ? `, then "${signOff()}"` : ''}.

Answer with the subject and the body (plain text, no subject line inside the body).`;

const NEW_SCHEMA = {
  type: 'object',
  properties: { subject: { type: 'string' }, body: { type: 'string' } },
  required: ['subject', 'body'],
  additionalProperties: false,
};

/** A new email (not a reply): a real subject, a greeting and sign-off, in the right tone for who it's to. */
export async function writeNewEmail(
  writer: AiWriter,
  to: string,
  instructions: string,
  history: PastEmail[],
  now = new Date(),
  subjectHint?: string,
): Promise<{ subject: string; body: string }> {
  const answer = await writer.json<{ subject?: string; body?: string }>({
    system: newSystem(),
    prompt: [
      `Today is ${now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}.`,
      `To: ${to}`,
      history.length
        ? `Recent email between them, newest first (for their name, the relationship and the tone):\n${history.map((h) => `- ${h.date} from ${h.from}: "${h.subject}" ${h.snippet.slice(0, 160)}`).join('\n')}`
        : `They haven't emailed each other before (as far as Life Hub can see). Work out the relationship from the address and what ${person()} says.`,
      `What ${person()} wants to say:\n${instructions.trim()}`,
      ...(subjectHint ? [`A subject idea (improve it if it's vague): ${subjectHint}`] : []),
    ].join('\n\n'),
    schema: NEW_SCHEMA,
    effort: 'medium',
  });
  const body = String(answer.body ?? '').trim();
  const subject = String(answer.subject ?? '')
    .replace(/^(re|fwd?):\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  if (!body || !subject) throw new Error("The AI's email came back empty. Try again.");
  return { subject, body };
}

/** Without AI: their words with a greeting, a plain subject and a sign-off. */
export function basicNewEmail(instructions: string, subjectHint?: string): { subject: string; body: string } {
  const text = instructions.trim();
  const subject = subjectHint?.trim() || text.split(/[.!?\n]/)[0].split(/\s+/).slice(0, 8).join(' ');
  return { subject: subject.charAt(0).toUpperCase() + subject.slice(1), body: `Hi,\n\n${text.charAt(0).toUpperCase() + text.slice(1)}\n\nThanks,${signOff() ? `\n${signOff()}` : ''}` };
}
