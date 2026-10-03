import fs from 'node:fs';
import type { GoogleClient } from '../settings';

/**
 * Hub's own Google client, written to google-client.json by the release build
 * from the repository's secrets. Missing in a plain checkout, where people paste
 * their own Client ID and secret in Settings instead.
 */
export function loadBuiltInGoogleClient(file: string): GoogleClient | null {
  try {
    const { clientId, clientSecret } = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<GoogleClient>;
    if (typeof clientId === 'string' && clientId.endsWith('.apps.googleusercontent.com') && typeof clientSecret === 'string' && clientSecret) {
      return { clientId, clientSecret };
    }
    console.warn('Hub: google-client.json is missing a valid clientId or clientSecret; ignoring it.');
  } catch {
    // No built-in client.
  }
  return null;
}
