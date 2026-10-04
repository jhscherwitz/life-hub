import { afterEach, describe, expect, it, vi } from 'vitest';
import { imagePart, toAiMessages } from '../electron/ai/images';
import { GeminiAi } from '../electron/ai/gemini';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
const JPG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

afterEach(() => vi.unstubAllGlobals());

describe('pictures in Chat', () => {
  it('takes only real pictures', () => {
    expect(imagePart(PNG)).toEqual({ mime: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUg==' });
    expect(imagePart('data:text/html;base64,PGgxPg==')).toBeNull();
    expect(imagePart('https://example.com/a.png')).toBeNull();
    expect(imagePart(42)).toBeNull();
  });

  it('sends pictures only with the newest message, and notes older ones', () => {
    const messages = toAiMessages([
      { role: 'user', content: 'Here’s my syllabus', images: [PNG] },
      { role: 'assistant', content: 'Got it.', actions: [{ type: 'add_task' }] },
      { role: 'user', content: 'And this flyer?', images: [JPG, 'nonsense', PNG] },
      { role: 'system', content: 'ignored' },
    ]);
    expect(messages).toEqual([
      { role: 'user', content: '[sent a picture] Here’s my syllabus' },
      { role: 'assistant', content: 'Got it.' },
      {
        role: 'user',
        content: 'And this flyer?',
        images: [
          { mime: 'image/jpeg', data: '/9j/4AAQSkZJRg==' },
          { mime: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUg==' },
        ],
      },
    ]);
    expect(toAiMessages('nope')).toEqual([]);
  });

  it('hands pictures to Gemini inline, before the words', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"reply":"ok","actions":[]}' }] } }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const ai = new GeminiAi('key', 'gemini-2.5-flash');
    await ai.json({ system: 's', prompt: 'p', schema: {}, effort: 'low', images: [{ mime: 'image/png', data: 'AAAA' }] });
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.contents[0].parts).toEqual([{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }, { text: 'p' }]);
    await ai.chat({ system: 's', messages: [{ role: 'user', content: 'what is this', images: [{ mime: 'image/jpeg', data: 'BBBB' }] }] });
    const chatBody = JSON.parse((fetch.mock.calls[1] as unknown as [string, RequestInit])[1].body as string);
    expect(chatBody.contents[0].parts[0]).toEqual({ inlineData: { mimeType: 'image/jpeg', data: 'BBBB' } });
  });
});
