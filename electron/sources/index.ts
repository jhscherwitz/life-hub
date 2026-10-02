import path from 'node:path';
import type { Sources } from './types';
import {
  SampleCalendarSource,
  SampleCommuteSource,
  SampleEmailSource,
  SampleTaskSource,
  SampleWeatherSource,
} from './sample';

export type { Sources } from './types';

/**
 * The one place that decides which implementation backs each part of the
 * dashboard. To connect a real service, write a class that implements the
 * matching interface in ./types.ts and return it here.
 */
export function createSources(dataDir: string): Sources {
  return {
    calendar: new SampleCalendarSource(),
    email: new SampleEmailSource(),
    tasks: new SampleTaskSource(path.join(dataDir, 'sample-tasks.json')),
    weather: new SampleWeatherSource(),
    commute: new SampleCommuteSource(),
  };
}
