/** How hard the model should think. Free models mostly ignore this; it picks token limits. */
export type Effort = 'low' | 'medium' | 'high';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * The free AI Life Hub writes with: Google Gemini (a free key) or a model on
 * this computer (Ollama). An interface so tests can fake it.
 */
export interface AiWriter {
  /** A short name for messages, like "Gemini". */
  readonly name: string;
  /** Asks for JSON matching a schema. */
  json<T>(request: { system: string; prompt: string; schema: Record<string, unknown>; effort: Effort; maxTokens?: number }): Promise<T>;
  /** A plain chat reply. */
  chat(request: { system: string; messages: ChatMessage[]; maxTokens?: number }): Promise<string>;
}

/** Reads a model's JSON answer, allowing for a ```json fence around it. */
export function parseJsonAnswer<T>(text: string, name: string): T {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new Error(`${name}'s answer couldn't be read. Try again.`);
  }
}

/** The schema, spelled out for the model, since free models follow it best when they can read it. */
export function schemaNote(schema: Record<string, unknown>): string {
  return `\n\nAnswer with only JSON (no other text) that matches this JSON Schema:\n${JSON.stringify(schema)}`;
}
