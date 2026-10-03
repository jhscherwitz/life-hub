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
  'briefing',
] as const;

export type WidgetType = (typeof WIDGET_TYPES)[number];

/** Widths on a 12-column grid: a quarter, a third, two thirds, or the full row. */
export type WidgetSize = 's' | 'm' | 'w' | 'f';

export const SIZE_COLUMNS: Record<WidgetSize, number> = { s: 3, m: 4, w: 8, f: 12 };

export interface WidgetInfo {
  title: string;
  description: string;
  sizes: WidgetSize[];
  defaultSize: WidgetSize;
}

export const WIDGETS: Record<WidgetType, WidgetInfo> = {
  meetings: { title: 'Meetings left', description: 'How many meetings are left today, and the next one.', sizes: ['s', 'm'], defaultSize: 's' },
  replies: { title: 'Need a reply', description: 'How many emails are waiting on you, and from whom.', sizes: ['s', 'm'], defaultSize: 's' },
  'tasks-open': { title: 'Tasks open', description: 'Open tasks and how many are due today.', sizes: ['s', 'm'], defaultSize: 's' },
  weather: { title: 'Weather', description: "Now, today's high and low, and the chance of rain.", sizes: ['s', 'm'], defaultSize: 's' },
  clock: { title: 'Clock', description: 'A big clock and the date.', sizes: ['s', 'm', 'w'], defaultSize: 's' },
  now: { title: 'Now', description: "What's on right now: your meeting, or your top task.", sizes: ['m', 'w', 'f'], defaultSize: 'm' },
  focus: { title: 'Focus (LockedIn)', description: 'One click to your LockedIn focus timer.', sizes: ['s', 'm', 'w'], defaultSize: 'm' },
  timeline: { title: "Today's timeline", description: 'Your day on a line, with a marker for now.', sizes: ['m', 'w', 'f'], defaultSize: 'w' },
  'coming-up': { title: 'Coming up', description: 'Your next few meetings, with Join buttons.', sizes: ['m', 'w', 'f'], defaultSize: 'm' },
  'reply-queue': { title: 'Need a reply', description: 'The emails waiting on you, with one-click drafts.', sizes: ['m', 'w', 'f'], defaultSize: 'm' },
  tasks: { title: 'Tasks', description: 'Your task list: add, tick off and delete.', sizes: ['m', 'w', 'f'], defaultSize: 'm' },
  briefing: { title: 'Daily briefing', description: "A short summary of the day, and the evening wrap-up.", sizes: ['m', 'w', 'f'], defaultSize: 'f' },
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
  { type: 'now', size: 'm' },
  { type: 'focus', size: 'm' },
  { type: 'coming-up', size: 'm' },
  { type: 'reply-queue', size: 'm' },
  { type: 'tasks', size: 'm' },
  { type: 'briefing', size: 'w' },
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
