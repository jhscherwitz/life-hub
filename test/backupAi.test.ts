import { describe, expect, it, vi } from 'vitest';
import { BackupAi, WithBackup, isOutOfAllowance, toJsonSchema } from '../electron/ai/backup';
import type { AiWriter } from '../electron/ai/types';

const reply = (message: unknown) => new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 });

describe('the free backup AI', () => {
  it('turns Gemini schemas into JSON Schema', () => {
    expect(toJsonSchema({ type: 'OBJECT', properties: { q: { type: 'STRING', enum: ['A'] }, n: { type: 'ARRAY', items: { type: 'NUMBER' } } } })).toEqual({
      type: 'object',
      properties: { q: { type: 'string', enum: ['A'] }, n: { type: 'array', items: { type: 'number' } } },
    });
  });

  it('calls tools step by step in the OpenAI format, then answers', async () => {
    const bodies: { messages: { role: string; tool_call_id?: string; content: string | null }[]; tools?: unknown[] }[] = [];
    const answers = [
      reply({ role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'calendar_days', arguments: '{"start":"2026-10-06"}' } }] }),
      reply({ role: 'assistant', content: 'You have chem lab at 2.' }),
    ];
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return answers.shift()!;
    });
    const ai = new BackupAi('groq', 'k', undefined, fetcher as unknown as typeof fetch);
    const run = vi.fn(async () => ['2:00 PM Chem lab']);
    const seen: string[] = [];
    const text = await ai.agent({
      system: 's',
      messages: [{ role: 'user', content: "what's today" }],
      functions: [{ name: 'calendar_days', description: 'd', parameters: { type: 'OBJECT', properties: { start: { type: 'STRING' } } } }],
      run,
      onText: (d) => seen.push(d),
    });
    expect(text).toBe('You have chem lab at 2.');
    expect(seen).toEqual(['You have chem lab at 2.']);
    expect(run).toHaveBeenCalledWith('calendar_days', { start: '2026-10-06' });
    expect(bodies[1].messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'c1' });
    expect(fetcher.mock.calls[0][0]).toBe('https://api.groq.com/openai/v1/chat/completions');
  });

  it('answers in place of Gemini only when Gemini is out', async () => {
    const main = { name: 'Gemini', json: vi.fn(), chat: vi.fn(async () => { throw new Error("You've used today's free Gemini allowance. It resets tomorrow."); }), agent: vi.fn(), search: vi.fn() } as unknown as AiWriter;
    const backup = { name: 'Groq', json: vi.fn(), chat: vi.fn(async () => 'from groq') } as unknown as AiWriter;
    const ai = new WithBackup(main, backup);
    expect(ai.name).toBe('Gemini');
    expect(await ai.chat({ system: 's', messages: [] })).toBe('from groq');
    expect(ai.search).toBeDefined();
    (main.chat as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Google didn't accept your Gemini key."));
    await expect(ai.chat({ system: 's', messages: [] })).rejects.toThrow(/didn't accept/);
    expect(isOutOfAllowance(new Error('Gemini is having trouble right now.'))).toBe(true);
    expect(new WithBackup({ name: 'Ollama', json: vi.fn(), chat: vi.fn() } as unknown as AiWriter, backup).agent).toBeUndefined();
  });
});
