import { describe, expect, it, vi } from 'vitest';
import { unsubscribe } from '../electron/unsubscribe';
import { toEmailMessage } from '../electron/google/gmail';
import { parseUnsubscribe } from '../src/shared/unsubscribe';

describe('unsubscribing from newsletters', () => {
  it('reads the List-Unsubscribe header', () => {
    expect(parseUnsubscribe('<mailto:leave@news.example>, <https://news.example/u?id=1>', 'List-Unsubscribe=One-Click')).toEqual({
      url: 'https://news.example/u?id=1',
      mailto: 'leave@news.example',
      oneClick: true,
    });
    expect(parseUnsubscribe('<http://plain.example/u>')).toBeNull();
    expect(parseUnsubscribe('')).toBeNull();
    const m = toEmailMessage({
      id: 'm1',
      threadId: 't1',
      payload: { headers: [{ name: 'From', value: 'News <n@news.example>' }, { name: 'List-Unsubscribe', value: '<https://news.example/u>' }] },
    });
    expect(m.unsubscribe).toEqual({ url: 'https://news.example/u' });
  });

  it('does one-click itself, otherwise opens the page, and never posts to a private address', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 200 }));
    const open = vi.fn();
    expect(await unsubscribe({ url: 'https://news.example/u', oneClick: true }, open, fetcher as unknown as typeof fetch)).toBe('done');
    expect(fetcher).toHaveBeenCalledWith('https://news.example/u', expect.objectContaining({ method: 'POST', body: 'List-Unsubscribe=One-Click' }));
    expect(await unsubscribe({ url: 'https://news.example/u' }, open, fetcher as unknown as typeof fetch)).toBe('opened');
    expect(open).toHaveBeenCalledWith('https://news.example/u');
    fetcher.mockClear();
    expect(await unsubscribe({ url: 'https://192.168.1.1/u', oneClick: true, mailto: 'x@y.z' }, open, fetcher as unknown as typeof fetch)).toBe('gmail');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
