import { describe, expect, it } from 'vitest';
import { parseAddressList } from '../electron/google/gmail';
import { parseCourses } from '../src/shared/canvas';
import { buildProfile, classMeets, describeProfile } from '../src/shared/profile';
import type { CalendarEvent, EmailMessage } from '../src/shared/types';

const mail = (to: { name: string; email: string }[], from = { name: 'Me', email: 'me@utsa.edu' }): EmailMessage => ({
  id: Math.random().toString(),
  from,
  to,
  subject: 's',
  snippet: '',
  receivedAt: '2026-10-01T00:00:00Z',
  unread: false,
});
const ev = (title: string, start: string, location?: string): CalendarEvent => ({ id: title + start, title, start: new Date(start).toISOString(), end: new Date(start).toISOString(), ...(location && { location }) });

describe("who's who", () => {
  it('reads Canvas teachers and To lines', () => {
    const [course] = parseCourses([{ id: 7, name: 'Biosciences II', course_code: 'BIO 1404', enrollments: [{ type: 'student' }], teachers: [{ display_name: 'Jane Lee' }] }], 'https://canvas.test');
    expect(course.teachers).toEqual(['Jane Lee']);
    expect(parseAddressList('"Lee, Jane" <jlee@utsa.edu>, sam@gmail.com')).toEqual([
      { name: 'Lee, Jane', email: 'jlee@utsa.edu' },
      { name: 'sam@gmail.com', email: 'sam@gmail.com' },
    ]);
  });

  it('learns classes with their teachers’ emails and meeting times, and who they email most', () => {
    const course = { id: '7', name: 'Biosciences II', code: 'BIO 1404', score: 91, grade: 'A', url: '', teachers: ['Dr. Jane Lee', 'Omar Diaz'] };
    const events = [ev('BIO 1404 Lecture', '2026-10-05T10:00', 'BSE 2.102'), ev('BIO 1404 Lecture', '2026-10-07T10:00', 'BSE 2.102'), ev('Gym', '2026-10-06T17:00')];
    expect(classMeets(course, events)).toBe('Mon/Wed 10:00 AM at BSE 2.102');
    const profile = buildProfile({
      courses: [course],
      sent: [mail([{ name: 'Sam', email: 'sam@gmail.com' }]), mail([{ name: 'Sam', email: 'Sam@gmail.com' }, { name: 'Jane Lee', email: 'jlee@utsa.edu' }]), mail([{ name: 'no', email: 'noreply@x.com' }])],
      received: [mail([], { name: 'Diaz, Omar', email: 'omar.diaz@utsa.edu' })],
      events,
      ignored: [],
    });
    expect(profile.classes[0].teachers).toEqual([
      { name: 'Dr. Jane Lee', email: 'jlee@utsa.edu' },
      { name: 'Omar Diaz', email: 'omar.diaz@utsa.edu' },
    ]);
    expect(profile.people.map((p) => [p.email, p.sent])).toEqual([
      ['sam@gmail.com', 2],
      ['jlee@utsa.edu', 1],
    ]);
    expect(describeProfile(profile)).toContain('BIO 1404 (Biosciences II), taught by Dr. Jane Lee <jlee@utsa.edu>, Omar Diaz <omar.diaz@utsa.edu>, meets Mon/Wed 10:00 AM at BSE 2.102');
  });

  it("leaves out what they said to forget, and says nothing when there's nothing", () => {
    const p = buildProfile({ courses: [], sent: [mail([{ name: 'Sam', email: 'sam@gmail.com' }])], received: [], events: [], ignored: ['person:sam@gmail.com'] });
    expect(p.people).toEqual([]);
    expect(describeProfile(p)).toBeNull();
  });
});
