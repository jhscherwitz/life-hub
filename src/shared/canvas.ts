// Canvas (the school learning system): your classes, current grades and
// upcoming work, read with an access token you make in your own Canvas
// account settings. Parsing lives here so it can be tested without Canvas.

export interface CanvasCourse {
  id: string;
  name: string;
  code: string;
  /** Current score in percent, or null when the class hides it. */
  score: number | null;
  /** Letter grade, when the class uses one. */
  grade: string | null;
  url: string;
  /** Teachers' names, when Canvas shares them. */
  teachers?: string[];
}

export interface CanvasAssignment {
  id: string;
  title: string;
  courseName: string;
  /** ISO time it's due. */
  due: string;
  url: string;
  submitted: boolean;
  missing: boolean;
  kind: 'assignment' | 'quiz' | 'discussion' | 'other';
}

export interface CanvasData {
  /** The name Canvas has for you. */
  user: string;
  courses: CanvasCourse[];
  assignments: CanvasAssignment[];
  fetchedAt: string;
  /** Set when the last refresh failed; the rest is from before. */
  error?: string;
}

/**
 * The school's Canvas address, from whatever was pasted: "canvas.school.edu",
 * "https://school.instructure.com/courses/12" and so on. Only https.
 */
export function canvasOrigin(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
    if (url.protocol !== 'https:' || !url.hostname.includes('.')) return null;
    return url.origin;
  } catch {
    return null;
  }
}

interface RawEnrollment {
  type?: string;
  computed_current_score?: number | null;
  computed_current_grade?: string | null;
  current_grading_period_score?: number | null;
}

interface RawCourse {
  id: number | string;
  name?: string;
  course_code?: string;
  access_restricted_by_date?: boolean;
  enrollments?: RawEnrollment[];
  teachers?: { display_name?: string }[];
}

/** Active classes you're a student in, with their current scores. */
export function parseCourses(raw: unknown, origin: string): CanvasCourse[] {
  if (!Array.isArray(raw)) return [];
  return (raw as RawCourse[])
    .filter((c) => c && !c.access_restricted_by_date && c.name)
    .map((c) => {
      const mine = (c.enrollments ?? []).find((e) => e.type === 'student') ?? c.enrollments?.[0];
      const score = mine?.computed_current_score ?? mine?.current_grading_period_score ?? null;
      return {
        id: String(c.id),
        name: c.name!.trim(),
        code: (c.course_code ?? c.name!).trim(),
        score: typeof score === 'number' ? Math.round(score * 10) / 10 : null,
        grade: mine?.computed_current_grade?.trim() || null,
        url: `${origin}/courses/${c.id}/grades`,
        ...(c.teachers?.length && { teachers: c.teachers.map((t) => t.display_name?.trim() ?? '').filter(Boolean) }),
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}

interface RawPlannerItem {
  plannable_id?: number | string;
  plannable_type?: string;
  plannable_date?: string;
  course_id?: number | string;
  context_name?: string;
  html_url?: string;
  plannable?: { title?: string; name?: string; due_at?: string | null; todo_date?: string | null };
  submissions?: false | { submitted?: boolean; missing?: boolean; graded?: boolean; excused?: boolean };
}

const KINDS: Record<string, CanvasAssignment['kind']> = { assignment: 'assignment', quiz: 'quiz', discussion_topic: 'discussion' };

/** Upcoming work from the Canvas planner, soonest first, skipping anything without a date. */
export function parsePlanner(raw: unknown, origin: string, courses: CanvasCourse[]): CanvasAssignment[] {
  if (!Array.isArray(raw)) return [];
  const names = new Map(courses.map((c) => [c.id, c.code]));
  const out: CanvasAssignment[] = [];
  for (const item of raw as RawPlannerItem[]) {
    const type = item?.plannable_type ?? '';
    if (!(type in KINDS)) continue;
    const due = item.plannable?.due_at ?? item.plannable?.todo_date ?? item.plannable_date;
    const title = item.plannable?.title ?? item.plannable?.name;
    if (!due || !title || Number.isNaN(Date.parse(due))) continue;
    const subs = item.submissions || {};
    const href = item.html_url ?? '';
    out.push({
      id: `${type}-${item.plannable_id}`,
      title: title.trim(),
      courseName: names.get(String(item.course_id)) ?? item.context_name ?? 'Canvas',
      due: new Date(due).toISOString(),
      url: href.startsWith('http') ? href : `${origin}${href}`,
      submitted: Boolean(subs.submitted || subs.excused),
      missing: Boolean(subs.missing),
      kind: KINDS[type],
    });
  }
  return out.sort((a, b) => a.due.localeCompare(b.due));
}

/** A colour band for a score: green, purple, amber or red. */
export function scoreTone(score: number | null): 'great' | 'good' | 'ok' | 'low' | 'none' {
  if (score === null) return 'none';
  if (score >= 90) return 'great';
  if (score >= 80) return 'good';
  if (score >= 70) return 'ok';
  return 'low';
}

/** The average of the classes that show a score. */
export function averageScore(courses: CanvasCourse[]): number | null {
  const scores = courses.map((c) => c.score).filter((s): s is number => s !== null);
  return scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null;
}
