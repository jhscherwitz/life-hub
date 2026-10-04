// "Report this problem": a GitHub issue filled in with what went wrong, opened
// in your browser so you can read it, and only sent if you click Submit there.

export const ISSUES_URL = 'https://github.com/jhscherwitz/life-hub/issues/new';

export interface ProblemReport {
  /** The error's message. */
  message: string;
  /** Where it happened in the code, if known. */
  stack?: string;
  /** What part of Life Hub was open ("Settings", "Inbox"). */
  where?: string;
}

/** Takes out things that could identify you: your username in file paths, and email addresses. */
export function scrub(text: string): string {
  return text
    .replace(/([\\/](?:Users|home)[\\/])[^\\/\s)]+/gi, '$1<you>')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>');
}

/** The new-issue link, kept short enough for a browser address bar. */
export function problemReportUrl(report: ProblemReport, info: { version: string; platform: string }): string {
  const message = scrub(String(report.message ?? '')).slice(0, 300) || 'Something went wrong';
  const stack = scrub(String(report.stack ?? ''))
    .split('\n')
    .slice(0, 12)
    .join('\n')
    .slice(0, 1500);
  const body = [
    '**What were you doing when it happened?**',
    '',
    '(Tell us here.)',
    '',
    '**Details** (filled in by Life Hub)',
    '',
    `- Version: ${info.version}`,
    `- System: ${info.platform}`,
    ...(report.where ? [`- Where: ${scrub(report.where).slice(0, 80)}`] : []),
    `- Error: ${message}`,
    ...(stack ? ['', '```', stack, '```'] : []),
  ].join('\n');
  const title = `Problem: ${message}`.slice(0, 120);
  return `${ISSUES_URL}?${new URLSearchParams({ title, body, labels: 'bug' }).toString()}`;
}
