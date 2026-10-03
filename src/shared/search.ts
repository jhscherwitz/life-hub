// Search everything: ranks things from every part of Life Hub against what
// was typed. The screen builds the list; this decides the order.

export type SearchKind =
  | 'action'
  | 'page'
  | 'task'
  | 'email'
  | 'event'
  | 'note'
  | 'countdown'
  | 'habit'
  | 'station'
  | 'widget'
  | 'course'
  | 'reminder'
  | 'stock';

export interface SearchItem {
  id: string;
  kind: SearchKind;
  title: string;
  subtitle?: string;
  /** Extra words that should find this item, like "settings" for Settings. */
  keywords?: string;
}

export const KIND_LABEL: Record<SearchKind, string> = {
  action: 'Do',
  page: 'Go to',
  task: 'Tasks',
  email: 'Email',
  event: 'Calendar',
  note: 'Notes',
  countdown: 'Countdowns',
  habit: 'Daily tasks',
  station: 'Radio',
  widget: 'Widgets',
  course: 'Canvas',
  reminder: 'Reminders',
  stock: 'Portfolio',
};

function fold(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Letters of `query` appear in order in `text`, starting at the start of a
 * word and close together ("arcgy" finds "Archaeology", but letters picked
 * from the middle of other words don't count).
 */
function subsequence(query: string, text: string): boolean {
  const maxSpan = query.length * 2 + 2;
  for (let start = text.indexOf(query[0]); start !== -1; start = text.indexOf(query[0], start + 1)) {
    if (start > 0 && !/[\s\-_/.:(]/.test(text[start - 1])) continue;
    let i = 0;
    for (let j = start; j < text.length && j - start < maxSpan; j++) {
      if (text[j] === query[i]) i++;
      if (i === query.length) return true;
    }
  }
  return false;
}

/**
 * How well an item matches, or 0 for no match. Every word typed has to be
 * found somewhere; title matches beat subtitle matches, and word starts beat
 * the middle of a word.
 */
export function scoreItem(item: SearchItem, query: string): number {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const title = fold(item.title);
  const rest = fold(`${item.subtitle ?? ''} ${item.keywords ?? ''}`);
  let score = 0;
  for (const w of words) {
    const titleAt = title.indexOf(w);
    if (titleAt === 0) score += 12;
    else if (titleAt > 0) score += /[\s\-_/.:(]/.test(title[titleAt - 1]) ? 9 : 5;
    else if (rest.includes(w)) score += 3;
    else if (w.length >= 4 && subsequence(w, title)) score += 1;
    else return 0;
  }
  if (title === fold(query).trim()) score += 10;
  // Shorter titles are usually what was meant.
  return score + Math.max(0, 3 - title.length / 30);
}

/** The matching items, best first, at most `perKind` of each kind. */
export function searchItems(items: SearchItem[], query: string, perKind = 5): SearchItem[] {
  const counts = new Map<SearchKind, number>();
  return items
    .map((item) => ({ item, score: scoreItem(item, query) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .filter(({ item }) => {
      const n = counts.get(item.kind) ?? 0;
      counts.set(item.kind, n + 1);
      return n < perKind;
    })
    .map((r) => r.item);
}

/** Results in groups by kind. The group with the best match comes first; items keep their order. */
export function groupResults(items: SearchItem[]): { kind: SearchKind; items: SearchItem[] }[] {
  const kinds = [...new Set(items.map((i) => i.kind))];
  return kinds.map((kind) => ({ kind, items: items.filter((i) => i.kind === kind) }));
}

/** Drops items whose id is already in the list (live results repeating loaded ones). */
export function mergeUnique(first: SearchItem[], more: SearchItem[]): SearchItem[] {
  const seen = new Set(first.map((i) => `${i.kind}:${i.id}`));
  return [...first, ...more.filter((i) => !seen.has(`${i.kind}:${i.id}`))];
}
