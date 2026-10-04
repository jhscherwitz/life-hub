import { HttpError, fetchJson } from '../http';
import { parseJsonAnswer, schemaNote, type AgentRequest, type AiWriter, type ChatMessage, type ImagePart, type WebAnswer } from './types';
import { runAgent } from './geminiAgent';

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

/** Which day a model last ran out (or wasn't allowed), so it isn't tried again until tomorrow. Shared by every GeminiAi. */
const outToday = new Map<string, string>();

function explain(err: unknown): string {
  if (err instanceof HttpError) {
    if (err.status === 400 || err.status === 401 || err.status === 403) return "Google didn't accept your Gemini key. Check it in Settings.";
    if (err.status === 429) return "You've used today's free Gemini allowance. It resets tomorrow.";
    if (err.status >= 500) return 'Gemini is having trouble right now. Try again in a minute.';
  }
  return err instanceof Error ? err.message : String(err);
}

/** Pictures go to Gemini inline, before the words about them. */
function pictures(images: ImagePart[] | undefined) {
  return (images ?? []).map((img) => ({ inlineData: { mimeType: img.mime, data: img.data } }));
}

/** Google Gemini with the person's own free API key. */
export class GeminiAi implements AiWriter {
  readonly name = 'Gemini';

  private pro: Promise<string | null> | null = null;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  /** Chat's models, best first: Pro when this key can use it today, then the everyday Flash model. */
  private async chatModels(): Promise<string[]> {
    this.pro ??= fetchJson<{ models?: GeminiModel[] }>(`${API}/models?pageSize=200`, { headers: { 'x-goog-api-key': this.apiKey } }).then(
      (r) => pickProModel(r.models ?? []),
      () => null,
    );
    const pro = await this.pro;
    const today = new Date().toDateString();
    return pro && outToday.get(pro) !== today ? [pro, this.model] : [this.model];
  }

  async agent(request: AgentRequest): Promise<string> {
    const today = new Date().toDateString();
    return runAgent(request, { apiKey: this.apiKey, models: await this.chatModels(), onModelFailed: (m) => outToday.set(m, today), fetcher: this.fetcher });
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

  private async generate(body: Record<string, unknown>): Promise<string> {
    return (await this.request(body)).text;
  }

  private async request(body: Record<string, unknown>): Promise<{ text: string; res: GenerateResponse }> {
    let res: GenerateResponse;
    try {
      res = await fetchJson<GenerateResponse>(
        `${API}/models/${encodeURIComponent(this.model)}:generateContent`,
        { method: 'POST', headers: { 'x-goog-api-key': this.apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
        120_000,
      );
    } catch (err) {
      throw new Error(explain(err));
    }
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

  /** Speech to text for the mic button: Gemini listens to the recording and writes down what was said. */
  async transcribe(audio: { mime: string; data: string }): Promise<string> {
    const text = await this.generate({
      systemInstruction: {
        parts: [
          {
            text: 'Write down exactly what the person says in this recording, in their words, with normal punctuation and capitals. Leave out ums and false starts. Answer with only the words they said, nothing else. If nobody speaks, answer with nothing but [silence].',
          },
        ],
      },
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: audio.mime, data: audio.data } }, { text: 'Transcribe this.' }] }],
      generationConfig: { maxOutputTokens: 2000, temperature: 0 },
    });
    const words = text.trim();
    return /^\[?silence\]?\.?$/i.test(words) ? '' : words;
  }

  async json<T>({ system, prompt, schema, maxTokens = 8000, images }: Parameters<AiWriter['json']>[0]): Promise<T> {
    const text = await this.generate({
      systemInstruction: { parts: [{ text: system + schemaNote(schema) }] },
      contents: [{ role: 'user', parts: [...pictures(images), { text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: maxTokens },
    });
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
