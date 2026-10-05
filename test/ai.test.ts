import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiAi, outForDay, pickGeminiModel, resetOutToday, stillIn } from '../electron/ai/gemini';
import { OllamaAi } from '../electron/ai/ollama';
import { parseJsonAnswer } from '../electron/ai/types';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Gemini', () => {
  it('picks the newest plain flash model that can write', () => {
    const can = ['generateContent'];
    expect(
      pickGeminiModel([
        { name: 'models/gemini-2.0-flash', supportedGenerationMethods: can },
        { name: 'models/gemini-2.5-flash', supportedGenerationMethods: can },
        { name: 'models/gemini-2.5-flash-lite', supportedGenerationMethods: can },
        { name: 'models/gemini-3.0-flash-preview', supportedGenerationMethods: can },
        { name: 'models/gemini-9-flash', supportedGenerationMethods: ['embedContent'] },
        { name: 'models/gemini-2.5-pro', supportedGenerationMethods: can },
      ]),
    ).toBe('gemini-2.5-flash');
    expect(pickGeminiModel([])).toBeNull();
  });

  it('checks a key by listing models, and explains a bad key', async () => {
    const fetch = vi.fn(async () => json({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] }));
    vi.stubGlobal('fetch', fetch);
    expect(await GeminiAi.connect('good-key')).toBe('gemini-2.5-flash');
    expect((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ 'x-goog-api-key': 'good-key' });

    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { message: 'API key not valid' } }, 400)));
    await expect(GeminiAi.connect('bad-key')).rejects.toThrow("Google didn't accept your Gemini key");
  });

  it('asks for JSON and reads the answer; chats with the right roles', async () => {
    const fetch = vi.fn(async () => json({ candidates: [{ content: { parts: [{ text: '{"summary":"Done."}' }] } }] }));
    vi.stubGlobal('fetch', fetch);
    const ai = new GeminiAi('key', 'gemini-2.5-flash');
    expect(await ai.json({ system: 's', prompt: 'p', schema: { type: 'object' }, effort: 'low' })).toEqual({ summary: 'Done.' });
    const [url, init] = fetch.mock.calls.filter((c) => String(c[0]).includes(':generate'))[0] as unknown as [string, RequestInit];
    expect(url).toContain('/models/gemini-2.5-flash:generateContent');
    expect(JSON.parse(init.body as string).generationConfig.responseMimeType).toBe('application/json');

    await ai.chat({ system: 's', messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }] });
    const body = JSON.parse((fetch.mock.calls.filter((c) => String(c[0]).includes(':generate'))[1] as unknown as [string, RequestInit])[1].body as string);
    expect(body.contents.map((c: { role: string }) => c.role)).toEqual(['user', 'model']);
  });

  it('sends background jobs to Flash-Lite and falls back when a model runs out for the day', async () => {
    resetOutToday();
    const listing = { models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'].map((m) => ({ name: `models/${m}`, supportedGenerationMethods: ['generateContent'] })) };
    const answer = json({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] });
    const daily = { error: { message: 'Quota exceeded for metric generate_content_free_tier_requests, quotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier' } };
    const used: string[] = [];
    const fetch = vi.fn(async (url: string) => {
      if (!url.includes(':generate')) return json(listing);
      const model = url.match(/models\/([^:]+):/)![1];
      used.push(model);
      return model === 'gemini-2.5-flash' ? json(daily, 429) : answer.clone();
    });
    vi.stubGlobal('fetch', fetch);
    const ai = new GeminiAi('key', 'gemini-2.5-flash');
    await ai.json({ system: 's', prompt: 'p', schema: {}, effort: 'low' });
    expect(used).toEqual(['gemini-2.5-flash-lite']);
    // Flash is out for the day: Lite answers, and Flash isn't asked again today.
    await ai.chat({ system: 's', messages: [{ role: 'user', content: 'hi' }] });
    await ai.chat({ system: 's', messages: [{ role: 'user', content: 'hi' }] });
    expect(used).toEqual(['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-flash-lite']);
    resetOutToday();
  });

  it('tells a daily limit from a per-minute one', () => {
    expect(outForDay(429, { error: { message: 'quotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier' } })).toBe(true);
    expect(outForDay(429, '{"error":{"message":"quotaId: GenerateRequestsPerMinutePerProjectPerModel-FreeTier"}}')).toBe(false);
    expect(outForDay(404, '')).toBe(true);
    expect(outForDay(500, '')).toBe(false);
    resetOutToday();
    expect(stillIn(['a', null, 'b', 'a'])).toEqual(['a', 'b']);
  });

  it("says when the day's free allowance is used up", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 429)));
    await expect(new GeminiAi('key', 'm').chat({ system: 's', messages: [] })).rejects.toThrow(/free Gemini allowance/);
  });
});

describe('Ollama', () => {
  it('lists downloaded models and chats on this computer', async () => {
    const fetch = vi.fn(async (url: string) =>
      url.endsWith('/api/tags') ? json({ models: [{ name: 'llama3.2' }] }) : json({ message: { content: '{"ok":true}' } }),
    );
    vi.stubGlobal('fetch', fetch);
    expect(await OllamaAi.listModels()).toEqual(['llama3.2']);
    expect(await new OllamaAi('llama3.2').json({ system: 's', prompt: 'p', schema: { type: 'object' }, effort: 'low' })).toEqual({ ok: true });
    const [url, init] = fetch.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:11434/api/chat');
    expect(JSON.parse(init.body as string)).toMatchObject({ model: 'llama3.2', stream: false, format: { type: 'object' } });
  });

  it("explains when Ollama isn't running", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))));
    await expect(OllamaAi.listModels()).rejects.toThrow(/Make sure the Ollama app is running/);
  });
});

describe('parseJsonAnswer', () => {
  it('reads plain or fenced JSON and explains junk', () => {
    expect(parseJsonAnswer('{"a":1}', 'X')).toEqual({ a: 1 });
    expect(parseJsonAnswer('```json\n{"a":1}\n```', 'X')).toEqual({ a: 1 });
    expect(() => parseJsonAnswer('nope', 'Gemini')).toThrow("Gemini's answer couldn't be read");
  });
});
