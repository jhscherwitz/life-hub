import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasClient } from '../electron/canvas';
import { averageScore, canvasOrigin, parseCourses, parsePlanner, scoreTone } from '../src/shared/canvas';

const ORIGIN = 'https://canvas.school.edu';
const COURSES = [
  {
    id: 12,
    name: 'Intro to Archaeology',
    course_code: 'ANTH 101',
    enrollments: [{ type: 'student', computed_current_score: 91.456, computed_current_grade: 'A-' }],
  },
  { id: 7, name: 'Biology', course_code: 'BIO 210', enrollments: [{ type: 'student', computed_current_score: null }] },
  { id: 3, name: 'Old class', access_restricted_by_date: true },
];
const PLANNER = [
  {
    plannable_id: 5,
    plannable_type: 'assignment',
    course_id: 12,
    html_url: '/courses/12/assignments/5',
    plannable: { title: 'Module test 2', due_at: '2026-10-04T23:59:00Z' },
    submissions: { submitted: false },
  },
  {
    plannable_id: 6,
    plannable_type: 'quiz',
    course_id: 7,
    html_url: '/courses/7/quizzes/6',
    plannable: { title: 'Cell quiz', due_at: '2026-10-02T15:00:00Z' },
    submissions: { submitted: true },
  },
  { plannable_id: 9, plannable_type: 'announcement', course_id: 7, plannable: { title: 'Welcome' } },
  { plannable_id: 10, plannable_type: 'assignment', course_id: 7, plannable: { title: 'No date' } },
];

describe('Canvas', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('turns whatever was pasted into the school address', () => {
    expect(canvasOrigin('canvas.school.edu')).toBe(ORIGIN);
    expect(canvasOrigin('https://school.instructure.com/courses/12?x=1')).toBe('https://school.instructure.com');
    expect(canvasOrigin('http://canvas.school.edu')).toBeNull();
    expect(canvasOrigin('not a url')).toBeNull();
    expect(canvasOrigin('')).toBeNull();
  });

  it('reads classes and scores, skipping closed ones', () => {
    const courses = parseCourses(COURSES, ORIGIN);
    expect(courses).toEqual([
      { id: '12', name: 'Intro to Archaeology', code: 'ANTH 101', score: 91.5, grade: 'A-', url: `${ORIGIN}/courses/12/grades` },
      { id: '7', name: 'Biology', code: 'BIO 210', score: null, grade: null, url: `${ORIGIN}/courses/7/grades` },
    ]);
    expect(averageScore(courses)).toBe(91.5);
    expect(scoreTone(91.5)).toBe('great');
    expect(scoreTone(65)).toBe('low');
    expect(scoreTone(null)).toBe('none');
  });

  it('reads upcoming work from the planner, soonest first', () => {
    const work = parsePlanner(PLANNER, ORIGIN, parseCourses(COURSES, ORIGIN));
    expect(work.map((w) => [w.title, w.courseName, w.kind, w.submitted])).toEqual([
      ['Cell quiz', 'BIO 210', 'quiz', true],
      ['Module test 2', 'ANTH 101', 'assignment', false],
    ]);
    expect(work[1].url).toBe(`${ORIGIN}/courses/12/assignments/5`);
  });

  it('asks Canvas with the token, caches, and explains a bad token', async () => {
    const fetch = vi.fn(async (url: string) => {
      const body = url.includes('/users/self') ? { short_name: 'Jacob' } : url.includes('/courses?') ? COURSES : PLANNER;
      return new Response(JSON.stringify(body), { status: 200 });
    });
    vi.stubGlobal('fetch', fetch);
    const client = new CanvasClient(ORIGIN, 'secret-token-1234567890');
    const data = await client.data();
    expect(data.user).toBe('Jacob');
    expect(data.courses).toHaveLength(2);
    expect(data.assignments).toHaveLength(2);
    expect((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ Authorization: 'Bearer secret-token-1234567890' });
    const calls = fetch.mock.calls.length;
    await client.data();
    expect(fetch.mock.calls.length).toBe(calls);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 401 })),
    );
    await expect(new CanvasClient(ORIGIN, 'bad').whoAmI()).rejects.toThrow(/didn't accept your access token/);
    const stale = await client.data(true);
    expect(stale.error).toMatch(/access token/);
    expect(stale.courses).toHaveLength(2);
  });

  it('asks Canvas with a sign-in from inside Life Hub, reading past its "while(1);" guard', async () => {
    const urls: string[] = [];
    const signedIn = async (url: string) => {
      urls.push(url);
      const body = url.includes('/users/self') ? { short_name: 'Jacob' } : url.includes('/courses?') ? COURSES : PLANNER;
      return new Response(`while(1);${JSON.stringify(body)}`, { status: 200 });
    };
    const data = await new CanvasClient(ORIGIN, signedIn).data();
    expect(data.error).toBeUndefined();
    expect(data.user).toBe('Jacob');
    expect(data.courses.map((c) => c.code)).toEqual(['ANTH 101', 'BIO 210']);
    expect(urls[0]).toBe(`${ORIGIN}/api/v1/users/self`);
  });

  it('says to sign in again when the Canvas sign-in ran out', async () => {
    const signedOut = async () => new Response('{"errors":[{"message":"user authorization required"}]}', { status: 401 });
    await expect(new CanvasClient(ORIGIN, signedOut).whoAmI()).rejects.toThrow(/sign-in ran out/);
    // A sign-in page instead of data means the same thing.
    const loginPage = async () => new Response('<html><body>Log in</body></html>', { status: 200 });
    await expect(new CanvasClient(ORIGIN, loginPage).whoAmI()).rejects.toThrow(/sign-in ran out/);
    const offline = async (): Promise<Response> => {
      throw new TypeError('fetch failed');
    };
    await expect(new CanvasClient(ORIGIN, offline).whoAmI()).rejects.toThrow(/Couldn't reach canvas.school.edu/);
  });
});
