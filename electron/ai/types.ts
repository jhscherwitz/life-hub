/** How hard the model should think. Free models mostly ignore this; it picks token limits. */
export type Effort = 'low' | 'medium' | 'high';

/** A picture for the AI to look at: its type and its bytes in base64. */
export interface ImagePart {
  mime: string;
  data: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Pictures attached to this message. */
  images?: ImagePart[];
}

/**
 * The free AI Life Hub writes with: Google Gemini (a free key) or a model on
 * this computer (Ollama). An interface so tests can fake it.
 */
export interface AiWriter {
  /** A short name for messages, like "Gemini". */
  readonly name: string;
  /** Asks for JSON matching a schema. */
  json<T>(request: { system: string; prompt: string; schema: Record<string, unknown>; effort: Effort; maxTokens?: number; images?: ImagePart[] }): Promise<T>;
  /** A plain chat reply. */
  chat(request: { system: string; messages: ChatMessage[]; maxTokens?: number }): Promise<string>;
  /**
   * Works step by step, like Claude: calls functions, sees each result, and
   * keeps going until it can answer. Streams its words as it writes them.
   * Missing on AIs that can't (then Chat uses the one-shot JSON way).
   */
  agent?(request: AgentRequest): Promise<string>;
  /** Turns a voice recording into text, when this AI can hear. */
  transcribe?(audio: ImagePart, onText?: (delta: string) => void): Promise<string>;
  /** Searches the web and answers from what it finds, when this AI can. */
  search?(query: string): Promise<WebAnswer>;
}

/** A short answer from a web search, with the pages it came from. */
export interface WebAnswer {
  answer: string;
  sources: { title: string; url: string }[];
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

/** Something the AI can call: a look-up or an action. `parameters` is Gemini's schema (OBJECT, STRING…). */
export interface AgentFunction {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

export interface AgentRequest {
  system: string;
  /** The conversation, oldest first. Pictures ride on the messages they came with. */
  messages: ChatMessage[];
  functions: AgentFunction[];
  /** Runs one call and returns what to tell the AI (any JSON). Throwing tells it the call failed. */
  run: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  /** Each bit of the answer as it's written. */
  onText?: (delta: string) => void;
  /** Rounds of calls before it must answer. */
  maxSteps?: number;
  /** Stops it (the Stop button): no more calls are made, and nothing more is done. */
  signal?: AbortSignal;
}
