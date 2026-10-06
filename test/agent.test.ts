import { describe, expect, it, vi } from 'vitest';
import { readStream, runAgent } from '../electron/ai/geminiAgent';
import { pickProModel } from '../electron/ai/gemini';
import { agentFunctions, readCall } from '../electron/smart/functions';

/** A Gemini streaming answer: each chunk is one server-sent event. */
const sse = (...chunks: unknown[]) =>
  new Response(new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(ch)}\r\n\r\n`)); c.close(); } }), { status: 200 });
const parts = (...p: unknown[]) => ({ candidates: [{ content: { role: 'model', parts: p } }] });

describe('step-by-step AI', () => {
  it('reads streamed words as they come, skipping its private thoughts', async () => {
    const seen: string[] = [];
    const res = sse(parts({ text: 'thinking…', thought: true }), parts({ text: 'Hel' }), parts({ text: 'lo', thoughtSignature: 'sig' }));
    const out = await readStream(res.body!, (d) => seen.push(d));
    expect(seen).toEqual(['Hel', 'lo']);
    expect(out.parts.at(-1)).toEqual({ text: 'lo', thoughtSignature: 'sig' });
  });

  it('calls a function, sees the result, then answers', async () => {
    const bodies: { contents: { role: string; parts: Record<string, unknown>[] }[] }[] = [];
    const answers = [sse(parts({ functionCall: { name: 'search_email', args: { query: 'from:prof' } }, thoughtSignature: 'abc' })), sse(parts({ text: 'Found it: ' }), parts({ text: 'Dr. Lee.' }))];
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return answers.shift()!;
    });
    const run = vi.fn(async () => [{ from: 'Dr. Lee' }]);
    const text = await runAgent(
      { system: 's', messages: [{ role: 'user', content: 'who is my prof' }], functions: agentFunctions(true), run },
      { apiKey: 'k', models: ['gemini-3-flash'], fetcher: fetcher as unknown as typeof fetch },
    );
    expect(text).toBe('Found it: Dr. Lee.');
    expect(run).toHaveBeenCalledWith('search_email', { query: 'from:prof' });
    // The second request carries the call (with its signature) and the result.
    const second = bodies[1].contents;
    expect(second[1]).toEqual({ role: 'model', parts: [{ functionCall: { name: 'search_email', args: { query: 'from:prof' } }, thoughtSignature: 'abc' }] });
    expect(second[2].parts[0]).toEqual({ functionResponse: { name: 'search_email', response: { result: [{ from: 'Dr. Lee' }] } } });
  });

  it('asks again when Gemini stops without a word', async () => {
    const urls: string[] = [];
    const bodies: { toolConfig?: { functionCallingConfig: { mode: string } } }[] = [];
    const answers = [sse(parts({ text: 'hmm', thought: true })), sse(parts({ text: 'About 4 miles.' }))];
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      urls.push(url);
      bodies.push(JSON.parse(String(init.body)));
      return answers.shift()!;
    });
    const request = { system: 's', messages: [{ role: 'user' as const, content: 'how far' }], functions: agentFunctions(true), run: vi.fn() };
    // On the next model when there is one…
    expect(await runAgent(request, { apiKey: 'k', models: ['gemini-3-pro', 'gemini-3-flash'], fetcher: fetcher as unknown as typeof fetch })).toBe('About 4 miles.');
    expect(urls.map((u) => u.match(/models\/([^:]+)/)![1])).toEqual(['gemini-3-pro', 'gemini-3-flash']);
    // …otherwise the same model, for a plain answer.
    answers.push(sse(parts({ text: '' })), sse(parts({ text: 'Done.' })));
    bodies.length = 0;
    expect(await runAgent(request, { apiKey: 'k', models: ['gemini-3-flash'], fetcher: fetcher as unknown as typeof fetch })).toBe('Done.');
    expect(bodies.map((b) => b.toolConfig?.functionCallingConfig.mode)).toEqual(['AUTO', 'NONE']);
    // Still nothing after one retry: say so.
    answers.push(sse(parts({ text: '' })), sse(parts({ text: '' })));
    await expect(runAgent(request, { apiKey: 'k', models: ['gemini-3-flash'], fetcher: fetcher as unknown as typeof fetch })).rejects.toThrow(/came back empty/);
  });

  it('tells the AI when a step failed, so it can say so', async () => {
    const answers = [sse(parts({ functionCall: { name: 'new_email', args: { title: 'x', text: 'hi' } } })), sse(parts({ text: "That didn't work." }))];
    let sent: { contents: { parts: { functionResponse?: { response: unknown } }[] }[] } | null = null;
    const fetcher = async (_u: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return answers.shift()!;
    };
    await runAgent(
      { system: 's', messages: [{ role: 'user', content: 'email x' }], functions: [], run: async () => { throw new Error('“x” isn’t an email address.'); } },
      { apiKey: 'k', models: ['m'], fetcher: fetcher as unknown as typeof fetch },
    );
    expect(sent!.contents[2].parts[0].functionResponse!.response).toEqual({ error: '“x” isn’t an email address.' });
  });

  it('falls back from Pro to Flash when Pro is out or not allowed, and remembers', async () => {
    const urls: string[] = [];
    const fetcher = async (url: string) => {
      urls.push(url);
      return url.includes('-pro:') ? new Response('{}', { status: 429 }) : sse(parts({ text: 'Hi!' }));
    };
    const failed: string[] = [];
    const text = await runAgent(
      { system: 's', messages: [{ role: 'user', content: 'hi' }], functions: [], run: async () => null },
      { apiKey: 'k', models: ['gemini-3-pro', 'gemini-3-flash'], fetcher: fetcher as unknown as typeof fetch, onModelFailed: (m) => failed.push(m) },
    );
    expect(text).toBe('Hi!');
    expect(failed).toEqual(['gemini-3-pro']);
    expect(urls.map((u) => u.match(/models\/([^:]+)/)![1])).toEqual(['gemini-3-pro', 'gemini-3-flash']);
  });

  it('picks the newest Pro model a key can see', () => {
    const m = (name: string) => ({ name: `models/${name}`, supportedGenerationMethods: ['generateContent'] });
    expect(pickProModel([m('gemini-2.5-pro'), m('gemini-3.1-pro'), m('gemini-3.1-pro-preview'), m('gemini-3-flash')])).toBe('gemini-3.1-pro');
    expect(pickProModel([m('gemini-3-flash')])).toBeNull();
  });

  it('turns function calls into the look-ups and actions Life Hub already checks', () => {
    expect(readCall('web_search', { query: 'bills score' })).toEqual({ tool: { name: 'web_search', query: 'bills score' } });
    expect(readCall('add_grocery', { title: '2 avocados' })).toEqual({ action: { type: 'add_grocery', title: '2 avocados' } });
    expect(readCall('add_task', {})).toBeNull();
    expect(readCall('rm_rf', { title: 'x' })).toBeNull();
    const names = agentFunctions(true).map((f) => f.name);
    expect(names).toContain('browser_click');
    expect(names).toContain('new_email');
    expect(agentFunctions(false).map((f) => f.name)).not.toContain('web_search');
  });
});

describe('Chat with a step-by-step AI', () => {
  it('does actions as it goes and returns what happened', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { SmartLayer } = await import('../electron/smart');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-agent-'));
    const writer = {
      name: 'Fake',
      json: async () => ({}),
      chat: async () => '',
      agent: async (req: { run: (n: string, a: Record<string, unknown>) => Promise<unknown>; onText?: (d: string) => void; system: string }) => {
        expect(req.system).toMatch(/Only say something is done after its function succeeded/);
        const ok = await req.run('add_task', { title: 'Essay', when: 'friday' });
        await expect(req.run('new_email', { title: 'bad', text: 'hi' })).rejects.toThrow(/isn't an email/);
        req.onText?.('Added it.');
        return `Added it. ${JSON.stringify(ok)}`;
      },
    };
    const smart = new SmartLayer(dir, () => writer as never);
    const act = vi.fn(async (a: { type: string; title: string }) =>
      a.type === 'add_task'
        ? { type: 'add_task' as const, label: 'Added task', detail: 'Essay · Fri', ok: true }
        : { type: 'new_email' as const, label: "Couldn't do that", detail: "“bad” isn't an email address.", ok: false },
    );
    const deltas: string[] = [];
    const out = await smart.chatAct(null, [{ role: 'user', content: 'add essay friday' }], { habits: [], act, onText: (d) => deltas.push(d) });
    expect(out.reply).toBe('Added it. {"done":"Added task","detail":"Essay · Fri"}');
    expect(out.results?.map((r) => r.ok)).toEqual([true, false]);
    expect(out.actions).toEqual([]);
    expect(deltas).toEqual(['Added it.']);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('Chat that claims a change it did not make', () => {
  const setup = async (secondTry: 'does it' | 'bluffs again') => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { SmartLayer } = await import('../electron/smart');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-agent-'));
    const calls: { system: string; messages: { role: string; content: string }[] }[] = [];
    const writer = {
      name: 'Fake',
      json: async () => ({}),
      chat: async () => '',
      agent: async (req: { run: (n: string, a: Record<string, unknown>) => Promise<unknown>; system: string; messages: { role: string; content: string }[] }) => {
        calls.push(req);
        if (calls.length === 1) return "I've set up a clean layout on your dashboard!";
        if (secondTry === 'bluffs again') return "I've applied the layout.";
        await req.run('arrange_widgets', { title: 'timeline: wide, weather: small' });
        return 'Rearranged it: timeline first, then weather.';
      },
    };
    const smart = new SmartLayer(dir, () => writer as never);
    const act = vi.fn(async () => ({ type: 'arrange_widgets' as const, label: 'Rearranged dashboard', detail: 'Timeline → Weather', ok: true }));
    const out = await smart.chatAct(null, [{ role: 'user', content: 'make a good layout' }], { habits: [], act, widgets: 'Weather (weather, small; comes tiny/small/medium)' });
    fs.rmSync(dir, { recursive: true, force: true });
    return { out, calls, act };
  };

  it('knows the dashboard, and is pushed to actually do it', async () => {
    const { out, calls, act } = await setup('does it');
    expect(calls[0].system).toMatch(/widgets in order: Weather \(weather/);
    expect(calls[1].messages.at(-1)?.content).toMatch(/didn't call any function/);
    expect(act).toHaveBeenCalledTimes(1);
    expect(out.reply).toBe('Rearranged it: timeline first, then weather.');
  });

  it('says plainly when nothing changed', async () => {
    const { out, act } = await setup('bluffs again');
    expect(act).not.toHaveBeenCalled();
    expect(out.reply).toMatch(/Nothing was actually changed/);
  });
});

describe('Gemini errors', () => {
  it("shows Google's reason instead of blaming the key or 'having trouble'", async () => {
    const { explainStatus } = await import('../electron/ai/geminiAgent');
    expect(explainStatus(400, '{"error":{"message":"Unsupported MIME type: audio/webm"}}')).toBe("Gemini couldn't do that (error 400): Unsupported MIME type: audio/webm");
    expect(explainStatus(400, { error: { message: 'API key not valid. Please pass a valid API key.' } })).toBe("Google didn't accept your Gemini key. Check it in Settings.");
    expect(explainStatus(429, '')).toMatch(/allowance/);
    expect(explainStatus(503, '')).toMatch(/having trouble/);
    expect(explainStatus(500, '{"error":{"message":"Internal error encountered."}}')).toMatch(/Internal error encountered/);
  });
});

describe('speak to type', () => {
  it('writes a real 16-bit mono WAV file', async () => {
    const { wavBytes } = await import('../src/renderer/components/Voice');
    const bytes = new Uint8Array(wavBytes(new Float32Array([0, 1, -1, 0.5]), 16000));
    const text = (a: number, n: number) => String.fromCharCode(...bytes.slice(a, a + n));
    const view = new DataView(bytes.buffer);
    expect([text(0, 4), text(8, 4), text(36, 4)]).toEqual(['RIFF', 'WAVE', 'data']);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint32(40, true)).toBe(8);
    expect([view.getInt16(46, true), view.getInt16(48, true)]).toEqual([32767, -32768]);
  });
});

describe('background blur', () => {
  it('keeps the blur between sharp and 60px, 30 by default', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { SettingsStore } = await import('../electron/settings');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-blur-'));
    const store = new SettingsStore(path.join(dir, 'settings.json'), { available: () => false, encrypt: (s: string) => s, decrypt: (s: string) => s } as never);
    expect(store.backgroundBlur()).toBe(30);
    store.setBackgroundBlur(0);
    expect(store.backgroundBlur()).toBe(0);
    store.setBackgroundBlur(500);
    expect(store.backgroundBlur()).toBe(60);
    store.setBackgroundBlur('nope');
    expect(store.backgroundBlur()).toBe(60);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('fast speech to text', () => {
  const models = { models: ['gemini-3-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite'].map((n) => ({ name: `models/${n}`, supportedGenerationMethods: ['generateContent'] })) };

  it('uses the fastest model with thinking off, streams the words, and retries without the setting if refused', async () => {
    const asked: { model: string; thinking: unknown }[] = [];
    const fake = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/models?')) return new Response(JSON.stringify(models), { status: 200 });
      const body = JSON.parse(String(init!.body));
      const model = url.match(/models\/([^:]+)/)![1];
      asked.push({ model, thinking: body.generationConfig.thinkingConfig ?? null });
      if (body.generationConfig.thinkingConfig) return new Response('{"error":{"message":"thinking_level is not supported"}}', { status: 400 });
      return sse(parts({ text: 'Email Sam ' }), parts({ text: 'about practice.' }));
    });
    vi.stubGlobal('fetch', fake);
    try {
      const { GeminiAi } = await import('../electron/ai/gemini');
      const ai = new GeminiAi('k', 'gemini-3-flash', fake as unknown as typeof fetch);
      const seen: string[] = [];
      const text = await ai.transcribe({ mime: 'audio/wav', data: 'AAAA' }, (d) => seen.push(d));
      expect(text).toBe('Email Sam about practice.');
      expect(seen).toEqual(['Email Sam ', 'about practice.']);
      expect(asked).toEqual([
        { model: 'gemini-3.1-flash-lite', thinking: { thinkingLevel: 'minimal' } },
        { model: 'gemini-3.1-flash-lite', thinking: null },
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('turns thinking off the right way for each model', async () => {
    const { noThinking } = await import('../electron/ai/gemini');
    expect(noThinking('gemini-2.5-flash-lite')).toEqual({ thinkingBudget: 0 });
    expect(noThinking('gemini-3.1-flash-lite')).toEqual({ thinkingLevel: 'minimal' });
  });
});

describe('the Stop button', () => {
  it('stops before doing what it was about to', async () => {
    const { StoppedError } = await import('../electron/ai/geminiAgent');
    const stop = new AbortController();
    const fetcher = async () => {
      // It decides to add a task, but they press Stop as it does.
      stop.abort();
      return sse(parts({ text: 'Adding it now. ' }), parts({ functionCall: { name: 'add_task', args: { title: 'Essay' } } }));
    };
    const run = vi.fn();
    const said: string[] = [];
    await expect(
      runAgent(
        { system: 's', messages: [{ role: 'user', content: 'add essay' }], functions: agentFunctions(false), run, onText: (d) => said.push(d), signal: stop.signal },
        { apiKey: 'k', models: ['m'], fetcher: fetcher as unknown as typeof fetch },
      ),
    ).rejects.toBeInstanceOf(StoppedError);
    expect(run).not.toHaveBeenCalled();
    expect(said.join('')).toBe('Adding it now. ');
  });
});
