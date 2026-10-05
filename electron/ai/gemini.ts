import { HttpError, fetchJson } from '../http';
import { parseJsonAnswer, schemaNote, type AgentRequest, type Effort, type AiWriter, type ChatMessage, type ImagePart, type WebAnswer } from './types';
import { API as AGENT_API, explainStatus, readStream, runAgent } from './geminiAgent';

const API = 'https://generativelanguage.googleapis.com/v1beta';
/** Where people get a free key. */
export const GEMINI_KEY_URL = 'https://aistudio.google.com/apikey';

interface GeminiModel {
  name: string;
  supportedGenerationMethods?: string[];
}

interface GenerateResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] };
  }[];
  promptFeedback?: { blockReason?: string };
}

/**
 * Picks the model to use from the ones a key can reach: the newest "flash"
 * model (fast, and on Google's free tier), skipping lite, preview, image,
 * audio and live variants. Google renames models over time, so this is
 * decided from their list rather than hard-coded.
 */
export function pickGeminiModel(models: GeminiModel[]): string | null {
  const version = (id: string) => Number(id.match(/^gemini-([\d.]+)/)?.[1] ?? 0);
  const usable = models
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((id) => /^gemini-[\d.]+-flash$/.test(id))
    .sort((a, b) => version(b) - version(a));
  return usable[0] ?? null;
}

/** The newest "pro" model a key can see, for chat. Google may not allow it on the free plan; Life Hub then falls back. */
export function pickProModel(models: GeminiModel[]): string | null {
  const version = (id: string) => Number(id.match(/^gemini-([\d.]+)/)?.[1] ?? 0);
  return (
    models
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''))
      .filter((id) => /^gemini-[\d.]+-pro$/.test(id))
      .sort((a, b) => version(b) - version(a))[0] ?? null
  );
}

/** The fastest model a key can see ("flash-lite"), for quick jobs like speech to text. */
export function pickLiteModel(models: GeminiModel[]): string | null {
  const version = (id: string) => Number(id.match(/^gemini-([\d.]+)/)?.[1] ?? 0);
  return (
    models
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''))
      .filter((id) => /^gemini-[\d.]+-flash-lite$/.test(id))
      .sort((a, b) => version(b) - version(a))[0] ?? null
  );
}

/** Thinking switched off (or as low as it goes), for jobs where speed matters more than reasoning. */
export function noThinking(model: string): Record<string, unknown> {
  const version = Number(model.match(/^gemini-([\d.]+)/)?.[1] ?? 0);
  return version >= 3 ? { thinkingLevel: 'minimal' } : { thinkingBudget: 0 };
}

/** Which day a model last ran out (or wasn't allowed), so it isn't tried again until tomorrow. Shared by every GeminiAi. */
const outToday = new Map<string, string>();

/**
 * Whether a failed request means the model is done for the day. A 429 can also
 * be the per-minute limit, which clears in a minute: that only skips it this once.
 */
export function outForDay(status: number, body: unknown): boolean {
  if (status === 403 || status === 404) return true;
  if (status !== 429) return false;
  const text = typeof body === 'string' ? body : JSON.stringify(body ?? '');
  return /per ?day|daily/i.test(text);
}

function markOut(model: string, status: number, body: unknown): void {
  if (outForDay(status, body)) outToday.set(model, new Date().toDateString());
}

/** Models in order, without repeats and without ones out for today. Always keeps the last, so a real error still shows. */
export function stillIn(models: (string | null | undefined)[], today = new Date().toDateString()): string[] {
  const list = [...new Set(models.filter((m): m is string => !!m))];
  const open = list.filter((m) => outToday.get(m) !== today);
  return open.length ? open : list.slice(-1);
}

/** Forget which models ran out (tests). */
export function resetOutToday(): void {
  outToday.clear();
}

function explain(err: unknown): string {
  if (err instanceof HttpError) return explainStatus(err.status, err.body);
  return err instanceof Error ? err.message : String(err);
}

/** Pictures go to Gemini inline, before the words about them. */
function pictures(images: ImagePart[] | undefined) {
  return (images ?? []).map((img) => ({ inlineData: { mimeType: img.mime, data: img.data } }));
}

/** Google Gemini with the person's own free API key. */
export class GeminiAi implements AiWriter {
  readonly name = 'Gemini';

  private listing: Promise<GeminiModel[]> | null = null;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  /** The models this key can see, asked once (listing is free). */
  private models(): Promise<GeminiModel[]> {
    this.listing ??= fetchJson<{ models?: GeminiModel[] }>(`${API}/models?pageSize=200`, { headers: { 'x-goog-api-key': this.apiKey } }).then(
      (r) => r.models ?? [],
      () => [],
    );
    return this.listing;
  }

  /**
   * Chat's models, best first: Pro when this key can use it today, the everyday
   * Flash model, then Flash-Lite, which has the biggest free daily allowance.
   */
  private async chatModels(): Promise<string[]> {
    const list = await this.models();
    return stillIn([pickProModel(list), this.model, pickLiteModel(list)]);
  }

  /**
   * Models for one-off jobs. Background work (effort low: summaries, news,
   * sorting mail, finding addresses) goes to Flash-Lite first, so it doesn't
   * use up the chat's allowance; the rest uses Flash and falls back to Lite.
   */
  private async jobModels(effort: Effort = 'medium'): Promise<string[]> {
    const lite = pickLiteModel(await this.models());
    return stillIn(effort === 'low' ? [lite, this.model] : [this.model, lite]);
  }

  async agent(request: AgentRequest): Promise<string> {
    return runAgent(request, { apiKey: this.apiKey, models: await this.chatModels(), onModelFailed: markOut, fetcher: this.fetcher });
  }

  /** Checks a key and finds the model to use. Listing models is free. */
  static async connect(apiKey: string): Promise<string> {
    let models: GeminiModel[];
    try {
      ({ models = [] } = await fetchJson<{ models?: GeminiModel[] }>(`${API}/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey } }));
    } catch (err) {
      throw new Error(explain(err));
    }
    const model = pickGeminiModel(models);
    if (!model) throw new Error("Your Gemini key works, but Google didn't offer a model Life Hub can use. Try again later.");
    return model;
  }

  private async generate(body: Record<string, unknown>, effort?: Effort): Promise<string> {
    return (await this.request(body, effort)).text;
  }

  private async request(body: Record<string, unknown>, effort?: Effort): Promise<{ text: string; res: GenerateResponse }> {
    const models = await this.jobModels(effort);
    let res: GenerateResponse | undefined;
    for (const [i, model] of models.entries()) {
      try {
        res = await fetchJson<GenerateResponse>(
          `${API}/models/${encodeURIComponent(model)}:generateContent`,
          { method: 'POST', headers: { 'x-goog-api-key': this.apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
          120_000,
        );
        break;
      } catch (err) {
        // Out of allowance, or not allowed: the next model takes over.
        if (err instanceof HttpError && [429, 403, 404].includes(err.status) && i < models.length - 1) {
          markOut(model, err.status, err.body);
          continue;
        }
        throw new Error(explain(err));
      }
    }
    if (!res) throw new Error(explainStatus(429));
    if (res.promptFeedback?.blockReason) throw new Error('Gemini declined to answer this one.');
    const text = (res.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
    if (!text.trim()) throw new Error("Gemini's answer came back empty. Try again.");
    return { text, res };
  }

  /**
   * Google Search through Gemini ("grounding"). It's in Google's free
   * allowance; Life Hub also limits how many it does a day (see tools.ts).
   */
  async search(query: string): Promise<WebAnswer> {
    const { text, res } = await this.request({
      systemInstruction: {
        parts: [{ text: `Today is ${new Date().toDateString()}. Search the web and answer with the facts you find: numbers, dates, names. Be short (under 200 words). Say if results disagree or are old.` }],
      },
      contents: [{ role: 'user', parts: [{ text: query }] }],
      tools: [{ google_search: {} }],
      generationConfig: { maxOutputTokens: 1500 },
    });
    const seen = new Set<string>();
    const sources = (res.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [])
      .map((c) => ({ title: c.web?.title ?? '', url: c.web?.uri ?? '' }))
      .filter((s) => /^https?:\/\//.test(s.url) && !seen.has(s.title || s.url) && seen.add(s.title || s.url))
      .slice(0, 6);
    return { answer: text.trim(), sources };
  }

  /**
   * Speech to text for the mic button. Speed matters most: the fastest model
   * ("flash-lite") with thinking off, and the words stream back as they come.
   */
  async transcribe(audio: { mime: string; data: string }, onText?: (delta: string) => void): Promise<string> {
    const lite = pickLiteModel(await this.models());
    const models = stillIn([lite, this.model]);
    const body = (thinking: Record<string, unknown> | null) => ({
      systemInstruction: {
        parts: [
          {
            text: 'Write down exactly what the person says in this recording, in their words, with normal punctuation and capitals. Leave out ums and false starts. Answer with only the words they said, nothing else. If nobody speaks, answer with nothing but [silence].',
          },
        ],
      },
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: audio.mime, data: audio.data } }, { text: 'Transcribe this.' }] }],
      generationConfig: { maxOutputTokens: 2000, temperature: 0, ...(thinking && { thinkingConfig: thinking }) },
    });
    let last = 0;
    for (const model of models) {
      // Older and newer models switch thinking off differently; if Google refuses the setting, ask without it.
      for (const thinking of [noThinking(model), null]) {
        let res: Response;
        try {
          res = await this.fetcher(`${AGENT_API}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
            method: 'POST',
            headers: { 'x-goog-api-key': this.apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify(body(thinking)),
            signal: AbortSignal.timeout(60_000),
          });
        } catch {
          throw new Error("Couldn't reach Gemini. Check your internet connection.");
        }
        if (res.ok && res.body) {
          const said: string[] = [];
          await readStream(res.body, (d) => {
            said.push(d);
            onText?.(d);
          });
          const words = said.join('').trim();
          return /^\[?silence\]?\.?$/i.test(words) ? '' : words;
        }
        last = res.status;
        const reason = await res.text().catch(() => '');
        if (res.status === 400 && thinking) continue;
        if (res.status === 429 || res.status === 403 || res.status === 404) {
          markOut(model, res.status, reason);
          break;
        }
        throw new Error(explainStatus(res.status, reason));
      }
    }
    throw new Error(explainStatus(last || 500));
  }

  async json<T>({ system, prompt, schema, effort, maxTokens = 8000, images }: Parameters<AiWriter['json']>[0]): Promise<T> {
    const text = await this.generate({
      systemInstruction: { parts: [{ text: system + schemaNote(schema) }] },
      contents: [{ role: 'user', parts: [...pictures(images), { text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: maxTokens },
    }, effort);
    return parseJsonAnswer<T>(text, this.name);
  }

  chat({ system, messages, maxTokens = 2000 }: { system: string; messages: ChatMessage[]; maxTokens?: number }): Promise<string> {
    return this.generate({
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [...pictures(m.images), { text: m.content || ' ' }] })),
      generationConfig: { maxOutputTokens: maxTokens },
    });
  }
}
