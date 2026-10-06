// Turns what went wrong with the AI into a plain sentence and what to do next.

export interface ChatProblem {
  /** What happened, in a sentence. */
  text: string;
  /** What to try. Empty when the original message says it best. */
  next: string;
  /** Trying the same message again could work (a busy server, a dropped connection). */
  retry: boolean;
}

export function explainChatError(message: string): ChatProblem {
  const m = message.toLowerCase();
  if (/(429|quota|rate.?limit|resource.?exhausted|allowance|too many requests|daily limit)/.test(m)) {
    return {
      text: 'The free AI has used up its allowance for now.',
      next: 'It comes back on its own (limits reset each minute and each day). A free backup key in Settings → Free AI keeps it going.',
      retry: true,
    };
  }
  if (/(401|403|api key|invalid key|unauthori[sz]ed|permission denied|key was|not valid)/.test(m)) {
    return { text: 'The AI turned down the key.', next: 'Check or paste the key again in Settings → Free AI.', retry: false };
  }
  if (/(fetch failed|network|enotfound|econnrefused|econnreset|etimedout|timed out|offline|socket hang up)/.test(m)) {
    return { text: "Couldn't reach the AI.", next: 'Check your internet connection, then try again.', retry: true };
  }
  if (/(overloaded|503|unavailable|try again later)/.test(m)) {
    return { text: 'The AI is busy right now.', next: 'Try again in a moment.', retry: true };
  }
  return { text: message || 'Something went wrong.', next: '', retry: true };
}
