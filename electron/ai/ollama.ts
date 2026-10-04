import { fetchJson } from '../http';
import { parseJsonAnswer, schemaNote, type AiWriter, type ChatMessage } from './types';

/** Where Ollama listens on this computer. */
const BASE = 'http://127.0.0.1:11434';
export const OLLAMA_DOWNLOAD_URL = 'https://ollama.com/download';

interface ChatResponse {
  message?: { content?: string };
}

function explain(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/Couldn't reach|took too long/.test(message)) return "Couldn't reach Ollama on this computer. Make sure the Ollama app is running.";
  return message;
}

/** A free model that runs on this computer through the Ollama app. Nothing leaves the computer. */
export class OllamaAi implements AiWriter {
  readonly name = 'Ollama';

  constructor(readonly model: string) {}

  /** The models already downloaded in Ollama. */
  static async listModels(): Promise<string[]> {
    try {
      const { models = [] } = await fetchJson<{ models?: { name: string }[] }>(`${BASE}/api/tags`, {}, 5_000);
      return models.map((m) => m.name);
    } catch (err) {
      throw new Error(explain(err));
    }
  }

  private async send(body: Record<string, unknown>): Promise<string> {
    let res: ChatResponse;
    try {
      // Local models can be slow on older computers, so allow a few minutes.
      res = await fetchJson<ChatResponse>(
        `${BASE}/api/chat`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: this.model, stream: false, ...body }) },
        300_000,
      );
    } catch (err) {
      throw new Error(explain(err));
    }
    const text = res.message?.content ?? '';
    if (!text.trim()) throw new Error("Ollama's answer came back empty. Try again.");
    return text;
  }

  async json<T>({ system, prompt, schema, images }: Parameters<AiWriter['json']>[0]): Promise<T> {
    const text = await this.send({
      messages: [
        { role: 'system', content: system + schemaNote(schema) },
        { role: 'user', content: prompt, ...(images?.length && { images: images.map((i) => i.data) }) },
      ],
      // Ollama can hold the model to a JSON schema.
      format: schema,
    });
    return parseJsonAnswer<T>(text, this.name);
  }

  chat({ system, messages }: { system: string; messages: ChatMessage[] }): Promise<string> {
    // Ollama takes pictures as plain base64 on the message (vision models like llava use them).
    const turns = messages.map((m) => ({ role: m.role, content: m.content, ...(m.images?.length && { images: m.images.map((i) => i.data) }) }));
    return this.send({ messages: [{ role: 'system', content: system }, ...turns] });
  }
}
