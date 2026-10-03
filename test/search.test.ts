import { describe, expect, it } from 'vitest';
import { groupResults, mergeUnique, scoreItem, searchItems, type SearchItem } from '../src/shared/search';

const items: SearchItem[] = [
  { id: 'settings', kind: 'page', title: 'Settings', keywords: 'preferences google ai background' },
  { id: 't1', kind: 'task', title: 'Read chapter 7', subtitle: 'Due Tuesday' },
  { id: 't2', kind: 'task', title: 'Lab report draft' },
  { id: 'e1', kind: 'email', title: 'Agenda for our 1:1', subtitle: 'Priya Shah' },
  { id: 'e2', kind: 'email', title: 'Lunch today?', subtitle: 'Sam Lee' },
  { id: 'c1', kind: 'countdown', title: 'Archaeology test', subtitle: 'Tomorrow' },
  { id: 'r1', kind: 'station', title: 'Groove Salad', subtitle: 'Chill beats' },
];

describe('search everything', () => {
  it('needs every word typed to match', () => {
    expect(scoreItem(items[1], 'read 7')).toBeGreaterThan(0);
    expect(scoreItem(items[1], 'read 8')).toBe(0);
    expect(scoreItem(items[0], '')).toBe(0);
  });

  it('finds things by title, by who or what they belong to, and by extra words', () => {
    expect(searchItems(items, 'priya').map((i) => i.id)).toEqual(['e1']);
    expect(searchItems(items, 'google').map((i) => i.id)).toEqual(['settings']);
    expect(searchItems(items, 'chill').map((i) => i.id)).toEqual(['r1']);
  });

  it('ranks the start of a title above the middle, and titles above details', () => {
    const list: SearchItem[] = [
      { id: 'mid', kind: 'task', title: 'Finish the lab' },
      { id: 'start', kind: 'task', title: 'Lab report draft' },
      { id: 'detail', kind: 'task', title: 'Email Sam', subtitle: 'about the lab' },
    ];
    expect(searchItems(list, 'lab').map((i) => i.id)).toEqual(['start', 'mid', 'detail']);
  });

  it('forgives skipped letters and accents', () => {
    expect(searchItems(items, 'arcgy').map((i) => i.id)).toEqual(['c1']);
    // Letters spread across a whole title don't count.
    expect(searchItems([{ id: 'x', kind: 'email', title: 'Five things worth reading this week' }], 'anth')).toEqual([]);
    expect(searchItems([{ id: 'x', kind: 'note', title: 'Café plans' }], 'cafe').map((i) => i.id)).toEqual(['x']);
  });

  it('caps each kind and puts the group with the best match first', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ id: `t${i}`, kind: 'task' as const, title: `Task ${i}` }));
    expect(searchItems(many, 'task', 5)).toHaveLength(5);
    const groups = groupResults(searchItems(items, 'gro'));
    expect(groups[0].kind).toBe('station');
    // Skipped letters only count for four or more.
    expect(searchItems(items, 'gro').map((i) => i.id)).not.toContain('e1');
  });

  it('skips live results that are already listed', () => {
    const merged = mergeUnique([items[3]], [items[3], items[4]]);
    expect(merged.map((i) => i.id)).toEqual(['e1', 'e2']);
  });
});
