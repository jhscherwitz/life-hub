// A free backup AI for when Gemini runs out: Groq or OpenRouter, which both
// speak the OpenAI chat format and have free plans (your own free key).
import { HttpError, fetchJson } from '../http';
import { parseJsonAnswer, schemaNote, type AgentRequest, type AiWriter, type ChatMessage } from './types';

export const BACKUP_PROVIDERS = {
  groq: {
    label: 'Groq',
    base: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    keyUrl: 'https://console.groq.com/keys',
  },
  openrouter: {
    label: 'OpenRouter',
    base: 'https://openrouter.ai/api/v1',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    keyUrl: 'https://openrouter.ai/keys',
  },
} as const;
export type BackupProvider = keyof typeof BACKUP_PROVIDERS;

interface OaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

interface OaResponse {
  choices?: { message?: OaMessage; finish_reason?: string }[];
}

/** Gemini's schema words (OBJECT, STRING) in the lowercase JSON Schema the OpenAI format wants. */
export function toJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toJsonSchema);
  if (!schema || typeof schema !== 'object') return schema;
  return Object.fromEntries(Object.entries(schema).map(([k, v]) => [k, k === 'type' && typeof v === 'string' ? v.toLowerCase() : toJsonSchema(v)]));
}

function explain(err: unknown, label: string): string {
  if (err instanceof HttpError) {
    if (err.status === 401 || err.status === 403) return `${label} didn't accept your key. Check it in Settings.`;
    if (err.status === 429) return `You've used ${label}'s free allowance for now too. Try again later.`;
    const msg = (err.body as { error?: { message?: string } } | null)?.error?.message;
    return `${label} couldn't do that (error ${err.status})${msg ? `: ${msg.slice(0, 200)}` : '.'}`;
  }
  return err instanceof Error ? err.message : String(err);
}

export class BackupAi implements AiWriter {
  readonly name: string;
  private readonly base: string;

  constructor(
    readonly provider: BackupProvider,
    private readonly key: string,
    readonly model: string = BACKUP_PROVIDERS[provider].model,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.name = BACKUP_PROVIDERS[provider].label;
    this.base = BACKUP_PROVIDERS[provider].base;
  }

  /** Checks a key by listing models (free). */
  static async check(provider: BackupProvider, key: string): Promise<void> {
    try {
      await fetchJson(`${BACKUP_PROVIDERS[provider].base}/models`, { headers: { Authorization: `Bearer ${key}` } });
    } catch (err) {
      throw new Error(explain(err, BACKUP_PROVIDERS[provider].label));
    }
  }

  private async send(body: Record<string, unknown>, signal?: AbortSignal): Promise<OaMessage> {
    let res: Response;
    try {
      res = await this.fetcher(`${this.base}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, ...body }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
      });
    } catch {
      throw new Error(`Couldn't reach ${this.name}. Check your internet connection.`);
    }
    const text = await res.text();
    if (!res.ok) {
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        // Not JSON.
      }
      throw new Error(explain(new HttpError(`${this.name} error`, res.status, parsed), this.name));
    }
    const message = (JSON.parse(text) as OaResponse).choices?.[0]?.message;
    if (!message) throw new Error(`${this.name}'s answer came back empty. Try again.`);
    return message;
  }

  private turns(system: string, messages: ChatMessage[]): OaMessage[] {
    // Text only: free models here don't take pictures.
    return [{ role: 'system', content: system }, ...messages.map((m) => ({ role: m.role, content: m.content || ' ' }) as OaMessage)];
  }

  async json<T>({ system, prompt, schema, maxTokens = 4000 }: Parameters<AiWriter['json']>[0]): Promise<T> {
    const m = await this.send({
      messages: [
        { role: 'system', content: `${system}${schemaNote(schema)}\nAnswer with JSON only.` },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      max_tokens: maxTokens,
    });
    return parseJsonAnswer<T>(m.content ?? '', this.name);
  }

  async chat({ system, messages, maxTokens = 2000 }: { system: string; messages: ChatMessage[]; maxTokens?: number }): Promise<string> {
    const m = await this.send({ messages: this.turns(system, messages), max_tokens: maxTokens });
    if (!m.content?.trim()) throw new Error(`${this.name}'s answer came back empty. Try again.`);
    return m.content;
  }

  /** The same step-by-step loop as Gemini's, in the OpenAI tool format. */
  async agent(request: AgentRequest): Promise<string> {
    const messages = this.turns(request.system, request.messages);
    const tools = request.functions.map((f) => ({
      type: 'function',
      function: { name: f.name, description: f.description, parameters: toJsonSchema(f.parameters ?? { type: 'object', properties: {} }) },
    }));
    const maxSteps = request.maxSteps ?? 10;
    const said: string[] = [];
    for (let step = 0; ; step++) {
      if (request.signal?.aborted) throw new Error('Stopped.');
      const final = step >= maxSteps;
      const m = await this.send({ messages, ...(tools.length && !final && { tools, tool_choice: 'auto' }), max_tokens: 4000 }, request.signal);
      if (m.content?.trim()) {
        if (said.length) request.onText?.('\n\n');
        said.push(m.content.trim());
        request.onText?.(m.content.trim());
      }
      const calls = final ? [] : (m.tool_calls ?? []);
      messages.push({ role: 'assistant', content: m.content ?? null, ...(calls.length && { tool_calls: calls }) });
      if (!calls.length) break;
      if (request.signal?.aborted) throw new Error('Stopped.');
      for (const call of calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>;
        } catch {
          // Bad arguments: run with none and let it see the error.
        }
        let content: string;
        try {
          content = JSON.stringify({ result: await request.run(call.function.name, args) });
        } catch (err) {
          content = JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content });
      }
    }
    const text = said.join('\n\n').trim();
    if (!text) throw new Error(`${this.name}'s answer came back empty. Try again.`);
    return text;
  }
}

/** Errors that mean "this AI is out for now", so the backup should answer. */
export function isOutOfAllowance(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /allowance|quota|rate limit|too many requests|error 429|resource.?exhausted|overloaded|having trouble|error 5\d\d/i.test(msg);
}

/**
 * Gemini first; when it's out for the day (or down), the backup answers instead.
 * Keeps Gemini's name and its extras (web search, hearing), which the backup lacks.
 */
export class WithBackup implements AiWriter {
  readonly name: string;
  readonly search?: AiWriter['search'];
  readonly transcribe?: AiWriter['transcribe'];
  /** Only when the main AI works step by step; otherwise Chat uses its one-shot way. */
  readonly agent?: (request: AgentRequest) => Promise<string>;

  constructor(
    private readonly main: AiWriter,
    private readonly backup: AiWriter,
  ) {
    this.name = main.name;
    if (main.search) this.search = main.search.bind(main);
    if (main.transcribe) this.transcribe = main.transcribe.bind(main);
    if (main.agent) {
      const backupAgent = backup.agent ? backup.agent.bind(backup) : (r: AgentRequest) => backup.chat(r);
      this.agent = (request) => this.either(() => main.agent!(request), () => backupAgent(request));
    }
  }

  private async either<T>(first: () => Promise<T>, second: () => Promise<T>): Promise<T> {
    try {
      return await first();
    } catch (err) {
      if (!isOutOfAllowance(err)) throw err;
      return second();
    }
  }

  json<T>(request: Parameters<AiWriter['json']>[0]): Promise<T> {
    return this.either(() => this.main.json<T>(request), () => this.backup.json<T>(request));
  }

  chat(request: Parameters<AiWriter['chat']>[0]): Promise<string> {
    return this.either(() => this.main.chat(request), () => this.backup.chat(request));
  }
}
