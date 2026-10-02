import Anthropic from '@anthropic-ai/sdk';

/** The Claude model Hub writes with. */
export const CLAUDE_MODEL = 'claude-opus-5-5';

export type Effort = 'low' | 'medium' | 'high';

/** Asks Claude for JSON matching a schema. An interface so tests can fake it. */
export interface AiWriter {
  json<T>(request: { system: string; prompt: string; schema: Record<string, unknown>; effort: Effort; maxTokens?: number }): Promise<T>;
}

/** Turns API failures into something Jacob can act on. */
export function explainClaudeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'Anthropic didn\'t accept your API key. Check it in Settings.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'Your Anthropic API key isn\'t allowed to use Claude. Check it in Settings.';
  if (err instanceof Anthropic.RateLimitError) return 'Claude is busy right now. Hub will try again later.';
  if (err instanceof Anthropic.BadRequestError && /credit balance/i.test(err.message)) {
    return 'Your Anthropic account is out of credit. Add some at console.anthropic.com.';
  }
  if (err instanceof Anthropic.APIConnectionError) return 'Couldn\'t reach Claude. Check your internet connection.';
  if (err instanceof Anthropic.APIError) return `Claude answered with an error (${err.status ?? 'unknown'}). Hub will try again later.`;
  return err instanceof Error ? err.message : String(err);
}

/** Writes with Claude using the API key from Settings. */
export class ClaudeWriter implements AiWriter {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });
  }

  /** Checks a key without spending anything: looking up a model is free. */
  static async verifyKey(apiKey: string): Promise<void> {
    try {
      await new Anthropic({ apiKey, maxRetries: 1, timeout: 20_000 }).models.retrieve(CLAUDE_MODEL);
    } catch (err) {
      throw new Error(explainClaudeError(err));
    }
  }

  async json<T>({ system, prompt, schema, effort, maxTokens = 8000 }: Parameters<AiWriter['json']>[0]): Promise<T> {
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await this.client.beta.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: prompt }],
        output_config: { effort, format: { type: 'json_schema', schema } },
        // If Claude's safety checks decline a request, Anthropic retries it on
        // their recommended fallback model instead of failing.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      });
    } catch (err) {
      throw new Error(explainClaudeError(err));
    }
    if (response.stop_reason === 'refusal') throw new Error('Claude declined to write this one.');
    if (response.stop_reason === 'max_tokens') throw new Error('Claude\'s answer was cut off. Try again.');
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error('Claude\'s answer couldn\'t be read. Try again.');
    }
  }
}
