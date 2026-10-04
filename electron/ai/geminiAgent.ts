// Gemini working step by step: it calls functions (look-ups and actions),
// sees each result, and goes on until it can answer, streaming its words.
import type { AgentRequest } from './types';

export const API = 'https://generativelanguage.googleapis.com/v1beta';

/** One piece of a message, as Gemini sends it. Kept whole (thought signatures included) when sent back. */
export interface Part {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
  functionResponse?: { name: string; response: Record<string, unknown>; id?: string };
  inlineData?: { mimeType: string; data: string };
}

interface Content {
  role: 'user' | 'model';
  parts: Part[];
}

/** A failed request, with Google's status so the caller can fall back to another model. */
export class GeminiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Google's own reason, from an error body like {"error":{"message":"…"}}. */
export function googleReason(body: unknown): string {
  const parsed = typeof body === 'string' ? (() => { try { return JSON.parse(body) as unknown; } catch { return null; } })() : body;
  const message = (parsed as { error?: { message?: unknown } } | null)?.error?.message;
  return typeof message === 'string' ? message.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
}

/**
 * A plain message for a failed Gemini request. Only a real key problem is
 * called a key problem; anything else shows Google's reason, so it can be fixed.
 */
export function explainStatus(status: number, body?: unknown): string {
  const reason = googleReason(body);
  if (status === 401 || (status === 400 && /api key|API_KEY/i.test(reason)) || (status === 403 && /key|permission/i.test(reason) && !/model/i.test(reason)))
    return "Google didn't accept your Gemini key. Check it in Settings.";
  if (status === 429) return "You've used today's free Gemini allowance. It resets tomorrow.";
  if (status >= 500 && !reason) return 'Gemini is having trouble right now. Try again in a minute.';
  return `Gemini couldn't do that (error ${status})${reason ? `: ${reason}` : '.'}`;
}

/** Reads Google's server-sent events into parts, calling onText as words arrive. */
export async function readStream(body: ReadableStream<Uint8Array>, onText?: (delta: string) => void): Promise<{ parts: Part[]; blocked: boolean }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parts: Part[] = [];
  let blocked = false;
  let buffer = '';
  const handle = (line: string) => {
    if (!line.startsWith('data:')) return;
    let chunk: { candidates?: { content?: { parts?: Part[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } };
    try {
      chunk = JSON.parse(line.slice(5).trim());
    } catch {
      return;
    }
    if (chunk.promptFeedback?.blockReason) blocked = true;
    for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
      parts.push(part);
      if (part.text && !part.thought) onText?.(part.text);
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let at: number;
    while ((at = buffer.indexOf('\n')) >= 0) {
      handle(buffer.slice(0, at).replace(/\r$/, ''));
      buffer = buffer.slice(at + 1);
    }
  }
  handle(buffer);
  return { parts, blocked };
}

/** Thought signatures belong to the model that wrote them; drop them when another model takes over. */
const unsigned = (contents: Content[]): Content[] => contents.map((c) => ({ ...c, parts: c.parts.map(({ thoughtSignature: _s, ...p }) => p) }));

/**
 * The step-by-step loop. `models` is tried in order: when one is out of free
 * allowance or not allowed for this key, the next takes over (and `onModelFailed`
 * hears about it, so it isn't tried again today).
 */
export async function runAgent(
  request: AgentRequest,
  opts: { apiKey: string; models: string[]; onModelFailed?: (model: string) => void; fetcher?: typeof fetch },
): Promise<string> {
  const fetcher = opts.fetcher ?? fetch;
  const models = [...opts.models];
  const contents: Content[] = request.messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [...(m.images ?? []).map((img) => ({ inlineData: { mimeType: img.mime, data: img.data } })), { text: m.content || ' ' }],
  }));
  const tools = request.functions.length ? [{ functionDeclarations: request.functions }] : undefined;
  const maxSteps = request.maxSteps ?? 10;
  const said: string[] = [];

  const ask = async (final: boolean): Promise<Part[]> => {
    for (;;) {
      const model = models[0];
      if (!model) throw new Error("You've used today's free Gemini allowance. It resets tomorrow.");
      let res: Response;
      try {
        res = await fetcher(`${API}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
          method: 'POST',
          headers: { 'x-goog-api-key': opts.apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: request.system }] },
            contents,
            ...(tools && { tools, toolConfig: { functionCallingConfig: { mode: final ? 'NONE' : 'AUTO' } } }),
            generationConfig: { maxOutputTokens: 8192 },
          }),
          signal: AbortSignal.timeout(180_000),
        });
      } catch (err) {
        throw new Error(err instanceof Error && err.name === 'TimeoutError' ? 'Gemini took too long to answer. Try again.' : "Couldn't reach Gemini. Check your internet connection.");
      }
      if (!res.ok || !res.body) {
        const status = res.status;
        // Out of allowance, or a model this key can't use: hand over to the next one.
        if ((status === 429 || status === 403 || status === 404) && models.length > 1) {
          opts.onModelFailed?.(model);
          models.shift();
          const fresh = unsigned(contents);
          contents.splice(0, contents.length, ...fresh);
          continue;
        }
        throw new GeminiError(explainStatus(status, await res.text().catch(() => '')), status);
      }
      const { parts, blocked } = await readStream(res.body, (delta) => {
        said.push(delta);
        request.onText?.(delta);
      });
      if (blocked) throw new Error('Gemini declined to answer this one.');
      return parts;
    }
  };

  for (let step = 0; ; step++) {
    const final = step >= maxSteps;
    const parts = await ask(final);
    const calls = parts.filter((p) => p.functionCall);
    if (!parts.length) break;
    contents.push({ role: 'model', parts });
    if (!calls.length || final) break;
    const responses = await Promise.all(
      calls.map(async ({ functionCall }) => {
        const { name, args = {}, id } = functionCall!;
        try {
          const result = await request.run(name, args);
          return { functionResponse: { name, response: { result }, ...(id && { id }) } };
        } catch (err) {
          return { functionResponse: { name, response: { error: err instanceof Error ? err.message : String(err) }, ...(id && { id }) } };
        }
      }),
    );
    contents.push({ role: 'user', parts: responses });
    // Words said before a call end a paragraph.
    if (said.length && !said[said.length - 1].endsWith('\n')) {
      said.push('\n\n');
      request.onText?.('\n\n');
    }
  }
  const text = said.join('').trim();
  if (!text) throw new Error("Gemini's answer came back empty. Try again.");
  return text;
}
