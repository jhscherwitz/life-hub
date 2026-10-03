import type { ChatMessage, ImagePart } from './types';

/** Pictures bigger than this (as base64) aren't sent; the screen shrinks them well below it. */
const MAX_BASE64 = 8_000_000;
const MAX_PER_MESSAGE = 4;

/** A picture from the chat box ("data:image/png;base64,…") as the AI wants it, or null if it isn't one. */
export function imagePart(url: unknown): ImagePart | null {
  if (typeof url !== 'string') return null;
  const m = url.match(/^data:(image\/(?:png|jpeg|webp|gif|heic|heif));base64,([A-Za-z0-9+/=]+)$/);
  if (!m || m[2].length > MAX_BASE64) return null;
  return { mime: m[1], data: m[2] };
}

/**
 * The conversation from the screen, cleaned up for the AI. Only the last
 * message keeps its pictures (sending every old picture again each turn
 * would be slow); earlier ones just say a picture was there.
 */
export function toAiMessages(turns: unknown): ChatMessage[] {
  if (!Array.isArray(turns)) return [];
  const valid = turns.filter((t) => {
    const role = (t as { role?: unknown } | null)?.role;
    return role === 'user' || role === 'assistant';
  }) as { role: 'user' | 'assistant'; content?: unknown; images?: unknown }[];
  const out: ChatMessage[] = [];
  valid.forEach((turn, i) => {
    const content = typeof turn.content === 'string' ? turn.content : '';
    const pictures = Array.isArray(turn.images) ? turn.images : [];
    const last = i === valid.length - 1;
    const images = last ? pictures.map(imagePart).filter((p): p is ImagePart => p !== null).slice(0, MAX_PER_MESSAGE) : [];
    const note = !last && pictures.length ? `[${pictures.length === 1 ? 'sent a picture' : `sent ${pictures.length} pictures`}] ` : '';
    out.push({ role: turn.role, content: note + content, ...(images.length && { images }) });
  });
  return out;
}
