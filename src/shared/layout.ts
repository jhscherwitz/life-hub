// The Today page is a grid of widgets that each person arranges for
// themselves. A layout is just an ordered list; the grid flows them in order.

export const WIDGET_TYPES = [
  'meetings',
  'replies',
  'tasks-open',
  'weather',
  'forecast',
  'clock',
  'now',
  'focus',
  'timeline',
  'coming-up',
  'reply-queue',
  'tasks',
  'habits',
  'briefing',
  'date',
  'moon',
  'sun',
  'radio',
  'year',
  'countdown',
  'note',
  'due',
  'month',
  'quote',
  'grades',
  'reminders',
  'portfolio',
  'christmas',
] as const;

export type WidgetType = (typeof WIDGET_TYPES)[number];

/**
 * Widths on a 24-column grid: a tiny square (an eighth of the row), a
 * quarter, a half, three quarters, or the full row. Any mix adds up to whole
 * rows, so there are no odd gaps.
 */
export type WidgetSize = 'xs' | 's' | 'm' | 'w' | 'f';

export const GRID_COLUMNS = 24;
export const SIZE_COLUMNS: Record<WidgetSize, number> = { xs: 3, s: 6, m: 12, w: 18, f: 24 };

/** The grid's measurements, matching .widgets in the styles. */
export const GRID_GAP = 12;
export const ROW_HEIGHT = 118;

/** How big a widget is on a grid this wide, in pixels, for previews. */
export function widgetBox(size: WidgetSize, rows: number, gridWidth: number): { width: number; height: number } {
  const column = (gridWidth - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS;
  const cols = SIZE_COLUMNS[size];
  return { width: Math.round(cols * column + (cols - 1) * GRID_GAP), height: rows * ROW_HEIGHT + (rows - 1) * GRID_GAP };
}

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
  /** Looks to pick from in the widget editor, first is the default. */
  styles?: { id: string; label: string }[];
}

export const WIDGETS: Record<WidgetType, WidgetInfo> = {
  meetings: { rows: 1, title: 'Meetings left', description: 'Your day as a ring of meetings, with how many are left.', sizes: ['xs'], defaultSize: 'xs' },
  replies: { rows: 1, title: 'Need a reply', description: 'How many emails are waiting on you, and from whom.', sizes: ['xs'], defaultSize: 'xs' },
  'tasks-open': {
    rows: 1,
    title: 'Tasks open',
    description: 'Open tasks and how many are due today.',
    sizes: ['xs'],
    defaultSize: 'xs',
    styles: [
      { id: 'ring', label: 'Ring' },
      { id: 'number', label: 'Number' },
    ],
  },
  weather: { rows: 1, title: 'Weather', description: "Now, today's high and low, and the chance of rain.", sizes: ['xs', 's', 'm'], defaultSize: 's' },
  forecast: {
    rows: 2,
    title: 'Weather today',
    description: 'The sky now, plus a chart of rain coming up, or the UV when it’s dry.',
    sizes: ['s', 'm'],
    defaultSize: 's',
  },
  clock: { rows: 1, title: 'Clock', description: 'A big clock and the date.', sizes: ['xs', 's', 'm'], defaultSize: 's' },
  now: { rows: 2, title: 'Now', description: "What's on right now: your meeting, or your top task.", sizes: ['xs', 's', 'm', 'w', 'f'], defaultSize: 's' },
  focus: { rows: 2, title: 'Focus (LockedIn)', description: 'One click to your LockedIn focus timer.', sizes: ['xs', 's', 'm'], defaultSize: 's' },
  timeline: { rows: 2, title: "Today's timeline", description: 'Your day on a line, with a marker for now.', sizes: ['m', 'w', 'f'], defaultSize: 'w' },
  'coming-up': { rows: 2, title: 'Coming up', description: 'Your next few meetings, with Join buttons.', sizes: ['xs', 's', 'm', 'w'], defaultSize: 's' },
  'reply-queue': { rows: 2, title: 'Need a reply', description: 'The emails waiting on you, with one-click drafts.', sizes: ['m', 'w', 'f'], defaultSize: 'm' },
  tasks: { rows: 2, title: 'Tasks', description: 'Your task list: add, tick off and delete.', sizes: ['s', 'm', 'w'], defaultSize: 'm' },
  habits: {
    rows: 2,
    title: 'Daily tasks',
    description: 'The same few tasks every day. Each one is a star; finish them all to light up your sky.',
    sizes: ['xs', 'm', 'w', 'f'],
    defaultSize: 'm',
  },
  date: { rows: 1, title: 'Date', description: 'Today as a little calendar page.', sizes: ['xs', 's'], defaultSize: 'xs' },
  moon: { rows: 1, title: 'Moon', description: "Tonight's moon: its phase, how full it is, and days to the full moon.", sizes: ['xs', 's'], defaultSize: 'xs' },
  sun: {
    rows: 1,
    title: 'Sun',
    description: 'The sun’s path across today, from sunrise to sunset, with where it is now.',
    sizes: ['xs', 's', 'm'],
    defaultSize: 's',
  },
  radio: { rows: 1, title: 'Radio', description: 'Free radio stations and your own music: play on the record, and open the full deck with its dial.', sizes: ['xs', 's'], defaultSize: 'xs' },
  year: { rows: 1, title: 'Year', description: 'How far through the year you are, one dot a day.', sizes: ['xs', 's', 'm'], defaultSize: 's' },
  countdown: { rows: 2, title: 'Countdown', description: 'Days until exams, trips and birthdays you add.', sizes: ['xs', 's', 'm'], defaultSize: 'xs' },
  note: { rows: 2, title: 'Note', description: 'A sticky note that saves as you type.', sizes: ['s', 'm', 'w'], defaultSize: 's' },
  due: { rows: 2, title: 'Due soon', description: 'Tasks with due dates, most urgent first.', sizes: ['xs', 's', 'm'], defaultSize: 's' },
  month: { rows: 2, title: 'Month', description: 'This month at a glance, with dots on days that have something due.', sizes: ['s'], defaultSize: 's' },
  quote: { rows: 1, title: 'Quote of the day', description: 'A short quote, new each day.', sizes: ['s', 'm', 'w'], defaultSize: 'm' },
  grades: { rows: 2, title: 'Grades', description: 'Your current grade in each class, from Canvas.', sizes: ['xs', 's', 'm'], defaultSize: 's' },
  reminders: {
    rows: 2,
    title: 'Reminders',
    description: 'Type “call mom at 6pm” and get a notification then, on this computer and your phone.',
    sizes: ['xs', 's', 'm'],
    defaultSize: 's',
  },
  portfolio: {
    rows: 2,
    title: 'Portfolio',
    description: 'What your stocks and crypto are worth right now, and how they did today. You type in what you own.',
    sizes: ['xs', 's', 'm'],
    defaultSize: 's',
  },
  christmas: {
    rows: 2,
    title: 'Christmas',
    description: 'A snowy countdown to Christmas: a tree whose lights come on as the day gets closer.',
    sizes: ['xs', 's', 'm'],
    defaultSize: 's',
  },
  briefing: { rows: 2, title: 'Daily briefing', description: 'A short summary of the day, and the evening wrap-up.', sizes: ['m', 'w', 'f'], defaultSize: 'f' },
};

/** How many rows a widget takes at a size. Tiny squares are always one row. */
export function rowsFor(type: WidgetType, size: WidgetSize): WidgetRows {
  return size === 'xs' ? 1 : WIDGETS[type].rows;
}

export interface PlacedWidget {
  type: WidgetType;
  size: WidgetSize;
  /** One of the widget's `styles`, when it has a choice of looks. */
  style?: string;
}

export const DEFAULT_LAYOUT: PlacedWidget[] = [
  { type: 'date', size: 'xs' },
  { type: 'weather', size: 's' },
  { type: 'meetings', size: 'xs' },
  { type: 'replies', size: 'xs' },
  { type: 'tasks-open', size: 'xs' },
  { type: 'christmas', size: 'xs' },
  { type: 'clock', size: 'xs' },
  { type: 'timeline', size: 'w' },
  { type: 'forecast', size: 's' },
  { type: 'habits', size: 'm' },
  { type: 'reply-queue', size: 'm' },
  { type: 'now', size: 's' },
  { type: 'tasks', size: 'm' },
  { type: 'coming-up', size: 's' },
  { type: 'sun', size: 's' },
  { type: 'year', size: 's' },
  { type: 'due', size: 'xs' },
  { type: 'moon', size: 'xs' },
  { type: 'radio', size: 'xs' },
  { type: 'focus', size: 'xs' },
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
    const style = (item as { style?: unknown }).style;
    out.push({
      type,
      size: WIDGETS[type].sizes.includes(size) ? size : WIDGETS[type].defaultSize,
      ...(typeof style === 'string' && WIDGETS[type].styles?.some((s) => s.id === style) && { style }),
    });
  }
  return out;
}

/** Widgets that aren't on the page yet, for the Add widget list. */
export function availableWidgets(layout: PlacedWidget[]): WidgetType[] {
  return WIDGET_TYPES.filter((t) => !layout.some((w) => w.type === t));
}

export function addWidget(layout: PlacedWidget[], type: WidgetType, size: WidgetSize = WIDGETS[type].defaultSize): PlacedWidget[] {
  if (layout.some((w) => w.type === type)) return layout;
  return [...layout, { type, size: WIDGETS[type].sizes.includes(size) ? size : WIDGETS[type].defaultSize }];
}

export function removeWidget(layout: PlacedWidget[], type: WidgetType): PlacedWidget[] {
  return layout.filter((w) => w.type !== type);
}

/** Switches a widget to its next look. */
export function nextWidgetStyle(layout: PlacedWidget[], type: WidgetType): PlacedWidget[] {
  const styles = WIDGETS[type].styles;
  if (!styles?.length) return layout;
  return layout.map((w) => {
    if (w.type !== type) return w;
    const at = Math.max(0, styles.findIndex((s) => s.id === w.style));
    return { ...w, style: styles[(at + 1) % styles.length].id };
  });
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
