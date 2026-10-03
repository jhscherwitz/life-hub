// The Today page is a grid of widgets that each person arranges for
// themselves. A layout is just an ordered list; the grid flows them in order.

export const WIDGET_TYPES = [
  'meetings',
  'replies',
  'tasks-open',
  'weather',
  'clock',
  'now',
  'focus',
  'timeline',
  'coming-up',
  'reply-queue',
  'tasks',
  'habits',
  'briefing',
] as const;

export type WidgetType = (typeof WIDGET_TYPES)[number];

/**
 * Widths in quarters of the row: a quarter, a half, three quarters, or the
 * full row. Any mix adds up to whole rows, so there are no odd gaps.
 */
export type WidgetSize = 's' | 'm' | 'w' | 'f';

export const SIZE_COLUMNS: Record<WidgetSize, number> = { s: 3, m: 6, w: 9, f: 12 };

/**
 * Every widget is one or two rows tall, so neighbours always line up, like
 * widgets on a phone home screen. Content that doesn't fit scrolls inside.
 */
export type WidgetRows = 1 | 2;

export interface WidgetInfo {
  title: string;
  rows: WidgetRows;
  description: string;
  sizes: WidgetSize[];
  defaultSize: WidgetSize;
}

export const WIDGETS: Record<WidgetType, WidgetInfo> = {
  meetings: { rows: 1, title: 'Meetings left', description: 'How many meetings are left today, and the next one.', sizes: ['s', 'm'], defaultSize: 's' },
  replies: { rows: 1, title: 'Need a reply', description: 'How many emails are waiting on you, and from whom.', sizes: ['s', 'm'], defaultSize: 's' },
  'tasks-open': { rows: 1, title: 'Tasks open', description: 'Open tasks and how many are due today.', sizes: ['s', 'm'], defaultSize: 's' },
  weather: { rows: 1, title: 'Weather', description: "Now, today's high and low, and the chance of rain.", sizes: ['s', 'm'], defaultSize: 's' },
  clock: { rows: 1, title: 'Clock', description: 'A big clock and the date.', sizes: ['s', 'm'], defaultSize: 's' },
  now: { rows: 2, title: 'Now', description: "What's on right now: your meeting, or your top task.", sizes: ['s', 'm', 'w', 'f'], defaultSize: 's' },
  focus: { rows: 2, title: 'Focus (LockedIn)', description: 'One click to your LockedIn focus timer.', sizes: ['s', 'm'], defaultSize: 's' },
  timeline: { rows: 2, title: "Today's timeline", description: 'Your day on a line, with a marker for now.', sizes: ['m', 'w', 'f'], defaultSize: 'w' },
  'coming-up': { rows: 2, title: 'Coming up', description: 'Your next few meetings, with Join buttons.', sizes: ['s', 'm', 'w'], defaultSize: 's' },
  'reply-queue': { rows: 2, title: 'Need a reply', description: 'The emails waiting on you, with one-click drafts.', sizes: ['m', 'w', 'f'], defaultSize: 'm' },
  tasks: { rows: 2, title: 'Tasks', description: 'Your task list: add, tick off and delete.', sizes: ['s', 'm', 'w'], defaultSize: 'm' },
  habits: { rows: 2, title: 'Daily tasks', description: 'The same few tasks every day. Each one is a star; finish them all to light up your sky.', sizes: ['m', 'w', 'f'], defaultSize: 'm' },
  briefing: { rows: 2, title: 'Daily briefing', description: "A short summary of the day, and the evening wrap-up.", sizes: ['m', 'w', 'f'], defaultSize: 'f' },
};

export interface PlacedWidget {
  type: WidgetType;
  size: WidgetSize;
}

export const DEFAULT_LAYOUT: PlacedWidget[] = [
  { type: 'meetings', size: 's' },
  { type: 'replies', size: 's' },
  { type: 'tasks-open', size: 's' },
  { type: 'weather', size: 's' },
  { type: 'timeline', size: 'w' },
  { type: 'now', size: 's' },
  { type: 'habits', size: 'm' },
  { type: 'reply-queue', size: 'm' },
  { type: 'coming-up', size: 's' },
  { type: 'tasks', size: 'm' },
  { type: 'focus', size: 's' },
  { type: 'briefing', size: 'f' },
];

function isWidgetType(value: unknown): value is WidgetType {
  return typeof value === 'string' && (WIDGET_TYPES as readonly string[]).includes(value);
}

/**
 * Cleans up a saved layout: drops widgets this version doesn't know, repeats,
 * and sizes a widget can't be. Anything unreadable falls back to the default.
 */
export function normalizeLayout(value: unknown): PlacedWidget[] {
  if (!Array.isArray(value)) return DEFAULT_LAYOUT.map((w) => ({ ...w }));
  const seen = new Set<WidgetType>();
  const out: PlacedWidget[] = [];
  for (const item of value) {
    const type = (item as { type?: unknown })?.type;
    if (!isWidgetType(type) || seen.has(type)) continue;
    seen.add(type);
    const size = (item as { size?: unknown }).size as WidgetSize;
    out.push({ type, size: WIDGETS[type].sizes.includes(size) ? size : WIDGETS[type].defaultSize });
  }
  return out;
}

/** Widgets that aren't on the page yet, for the Add widget list. */
export function availableWidgets(layout: PlacedWidget[]): WidgetType[] {
  return WIDGET_TYPES.filter((t) => !layout.some((w) => w.type === t));
}

export function addWidget(layout: PlacedWidget[], type: WidgetType): PlacedWidget[] {
  if (layout.some((w) => w.type === type)) return layout;
  return [...layout, { type, size: WIDGETS[type].defaultSize }];
}

export function removeWidget(layout: PlacedWidget[], type: WidgetType): PlacedWidget[] {
  return layout.filter((w) => w.type !== type);
}

export function resizeWidget(layout: PlacedWidget[], type: WidgetType, size: WidgetSize): PlacedWidget[] {
  if (!WIDGETS[type].sizes.includes(size)) return layout;
  return layout.map((w) => (w.type === type ? { ...w, size } : w));
}

/** Moves one widget to where another is, as when dropping it there. */
export function moveWidget(layout: PlacedWidget[], type: WidgetType, onto: WidgetType): PlacedWidget[] {
  const from = layout.findIndex((w) => w.type === type);
  const to = layout.findIndex((w) => w.type === onto);
  if (from === -1 || to === -1 || from === to) return layout;
  const next = [...layout];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
