// Who Life Hub is for: the name they gave in setup. The AI's instructions use
// it ("Sam's morning briefing", replies signed "Sam"), so nobody's name is
// built into the app.

let name = '';

export function setPerson(next: string | undefined): void {
  name = String(next ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

/** Their name, or "the user" before setup. */
export function person(): string {
  return name || 'the user';
}

/** "Sam's", or "the user's". */
export function persons(): string {
  return name ? `${name}'${name.endsWith('s') ? '' : 's'}` : "the user's";
}

/** How replies are signed: their first name, or nothing before setup. */
export function signOff(): string {
  return name.split(' ')[0] ?? '';
}
