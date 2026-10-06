import { describe, expect, it } from 'vitest';
import type { CanvasAssignment, CanvasCourse } from '../src/shared/canvas';
import { canvasNews, dueThisWeek, emptyCanvasWatch, normalizeCanvasWatch, planCanvasTasks } from '../src/shared/canvasWatch';
import type { Task } from '../src/shared/types';

const NOW = new Date('2026-10-05T12:00:00');
const at = (days: number) => new Date(NOW.getTime() + days * 86_400_000).toISOString();
const work = (id: string, days: number, extra: Partial<CanvasAssignment> = {}): CanvasAssignment => ({
  id,
  title: `Work ${id}`,
  courseName: 'BIO 1404',
  due: at(days),
  url: 'https://canvas.test/a',
  submitted: false,
  missing: false,
  kind: 'assignment',
  ...extra,
});
const course = (id: string, score: number | null): CanvasCourse => ({ id, name: `Class ${id}`, code: id, score, grade: null, url: 'https://canvas.test/c' });

describe('Canvas assignments as tasks', () => {
  it('adds what is due in the next two weeks, once, and skips turned-in, past and far-off work', () => {
    const plan = planCanvasTasks(
      [work('a', 2), work('b', -1), work('c', 20), work('d', 3, { submitted: true }), work('e', 1, { kind: 'other' }), work('f', 5)],
      { f: 'task-f' },
      [],
      NOW,
    );
    expect(plan.add.map((a) => a.id)).toEqual(['a']);
    expect(plan.complete).toEqual([]);
  });

  it('ticks off the task once the work is turned in, and never brings back a deleted one', () => {
    const tasks: Task[] = [{ id: 't1', title: 'Work a (BIO 1404)', done: false }];
    expect(planCanvasTasks([work('a', 2, { submitted: true })], { a: 't1' }, tasks, NOW).complete).toEqual(['t1']);
    // Deleted task: linked, so it isn't added again.
    expect(planCanvasTasks([work('a', 2)], { a: 'gone' }, [], NOW)).toEqual({ add: [], complete: [] });
  });
});

describe('Canvas alerts', () => {
  it('only takes note the first time, then reports new announcements and grade changes', () => {
    const first = canvasNews(emptyCanvasWatch(), [course('1', 88)], [{ id: 'x', title: 'Old news', courseId: '1', postedAt: '', url: 'https://canvas.test/x' }]);
    expect(first.alerts).toEqual([]);
    const second = canvasNews(first.state, [course('1', 91.25), course('2', null)], [
      { id: 'x', title: 'Old news', courseId: '1', postedAt: '', url: 'https://canvas.test/x' },
      { id: 'y', title: 'Exam moved to Thursday', courseId: '1', postedAt: '', url: 'https://canvas.test/y' },
    ]);
    expect(second.alerts.map((a) => a.title)).toEqual(['Grade went up in Class 1', 'New announcement in Class 1']);
    expect(second.alerts[0].body).toBe('88% → 91.3%');
    expect(second.alerts[1].body).toBe('Exam moved to Thursday');
    // A class that just got a score.
    const third = canvasNews(second.state, [course('1', 91.25), course('2', 75)], []);
    expect(third.alerts.map((a) => a.title)).toEqual(['Grade posted in Class 2']);
  });

  it('survives a broken saved file', () => {
    expect(normalizeCanvasWatch('nope')).toEqual(emptyCanvasWatch());
  });
});

describe('Canvas in the briefing', () => {
  it("lists this week's unfinished work, soonest first", () => {
    const line = dueThisWeek([work('b', 4), work('a', 1), work('c', 9), work('d', 2, { submitted: true })], NOW);
    expect(line).toMatch(/^Work a \(BIO 1404\), \w{3}; Work b \(BIO 1404\), \w{3}$/);
    expect(dueThisWeek([], NOW)).toBeNull();
  });
});
