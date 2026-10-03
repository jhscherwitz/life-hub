import path from 'node:path';
import type { GoogleAuth } from '../google/auth';
import { GoogleCalendarSource } from '../google/calendar';
import { GmailSource } from '../google/gmail';
import type { SettingsStore } from '../settings';
import { SampleCalendarSource, SampleEmailSource, SampleWeatherSource } from './sample';
import { LocalTaskSource } from './tasks';
import { OpenMeteoWeatherSource } from './weather';
import type { Sources } from './types';

export type { Sources } from './types';

export interface SourceContext {
  dataDir: string;
  settings: SettingsStore;
  google: GoogleAuth;
}

/**
 * The one place that decides which implementation backs each part of the
 * dashboard. Real sources are used once they're set up in Settings; until
 * then that section shows sample data. Called again whenever settings change.
 */
export function createSources({ dataDir, settings, google }: SourceContext): Sources {
  const signedIn = google.isSignedIn();
  const place = settings.weatherPlace();

  return {
    calendar: signedIn ? new GoogleCalendarSource(google) : new SampleCalendarSource(),
    email: signedIn ? new GmailSource(google) : new SampleEmailSource(),
    tasks: new LocalTaskSource(path.join(dataDir, 'tasks.json'), path.join(dataDir, 'sample-tasks.json')),
    weather: place ? new OpenMeteoWeatherSource(place) : new SampleWeatherSource(),
  };
}
