import { describe, expect, it } from 'vitest';
import { explainChatError } from '../src/shared/chatErrors';

describe('chat errors in plain words', () => {
  it('names a spent allowance and says what to do', () => {
    const p = explainChatError('Gemini error 429: Resource has been exhausted (quota)');
    expect(p.text).toMatch(/allowance/);
    expect(p.next).toMatch(/backup/);
    expect(p.retry).toBe(true);
  });

  it('tells a rejected key from a dropped connection', () => {
    expect(explainChatError('API key not valid. Please pass a valid API key.').retry).toBe(false);
    expect(explainChatError('TypeError: fetch failed').text).toMatch(/reach the AI/);
  });

  it('keeps anything else as it was written', () => {
    expect(explainChatError('The model said no').text).toBe('The model said no');
    expect(explainChatError('').text).toBe('Something went wrong.');
  });
});
