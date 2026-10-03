import { HttpError, fetchJson } from '../http';
import { parseJsonAnswer, schemaNote, type AiWriter, type ChatMessage } from './types';

const API = 'https://generativelanguage.googleapis.com/v1beta';
/** Where people get a free key. */
export const GEMINI_KEY_URL = 'https://aistudio.google.com/apikey';

interface GeminiModel {
  name: string;
  supportedGenerationMethods?: string[];
}

interface GenerateResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
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

function explain(err: unknown): string {
  if (err instanceof HttpError) {
    if (err.status === 400 || err.status === 401 || err.status === 403) return "Google didn't accept your Gemini key. Check it in Settings.";
    if (err.status === 429) return "You've used today's free Gemini allowance. It resets tomorrow.";
    if (err.status >= 500) return 'Gemini is having trouble right now. Try again in a minute.';
  }
  return err instanceof Error ? err.message : String(err);
}

/** Google Gemini with the person's own free API key. */
export class GeminiAi implements AiWriter {
  readonly name = 'Gemini';

  constructor(
    private readonly apiKey: string,
    readonly model: string,
  ) {}

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
    return text;
  }

  async json<T>({ system, prompt, schema, maxTokens = 8000 }: Parameters<AiWriter['json']>[0]): Promise<T> {
    const text = await this.generate({
      systemInstruction: { parts: [{ text: system + schemaNote(schema) }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: maxTokens },
    });
    return parseJsonAnswer<T>(text, this.name);
  }

  chat({ system, messages, maxTokens = 2000 }: { system: string; messages: ChatMessage[]; maxTokens?: number }): Promise<string> {
    return this.generate({
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { maxOutputTokens: maxTokens },
    });
  }
}
