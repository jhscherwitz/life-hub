import { BrowserWindow, session, type Session } from 'electron';
import { CanvasClient, type SignedInFetch } from './canvas';
import { browserUserAgent } from './media';

// For schools that turned Canvas access tokens off: you sign in to Canvas
// yourself, in a small window showing your school's own sign-in page, and Life
// Hub reads your grades with that sign-in. Life Hub never sees your password;
// it only keeps the sign-in cookie Canvas gives back, in its own storage.

const PARTITION = 'persist:canvas';

function canvasSession(): Session {
  const ses = session.fromPartition(PARTITION);
  // Some school sign-in pages (Google, Microsoft) turn away browsers they don't recognize.
  ses.setUserAgent(browserUserAgent(process.platform, process.versions.chrome ?? '130'));
  return ses;
}

/** Asks Canvas with the saved sign-in. */
export function signedInFetch(): SignedInFetch {
  return (url) =>
    canvasSession().fetch(url, {
      headers: { Accept: 'application/json' },
      credentials: 'include',
      signal: AbortSignal.timeout(20_000),
    });
}

/**
 * Canvas often signs you in only until the browser closes. Keep that sign-in
 * for two weeks instead, so Life Hub doesn't ask every time it starts.
 */
async function keepSignedIn(origin: string): Promise<void> {
  const ses = canvasSession();
  const host = new URL(origin).hostname;
  const until = Date.now() / 1000 + 14 * 86_400;
  for (const c of await ses.cookies.get({ domain: host })) {
    if (!c.session) continue;
    await ses.cookies
      .set({
        url: `${origin}${c.path ?? '/'}`,
        name: c.name,
        value: c.value,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        sameSite: c.sameSite,
        expirationDate: until,
        ...(c.hostOnly ? {} : { domain: c.domain }),
      })
      .catch(() => undefined);
  }
  await ses.cookies.flushStore();
}

async function signedIn(origin: string): Promise<boolean> {
  try {
    await new CanvasClient(origin, signedInFetch()).whoAmI();
    return true;
  } catch {
    return false;
  }
}

/**
 * Opens your school's Canvas sign-in page. Resolves once you're signed in
 * (right away if you already are), or rejects if you close the window first.
 */
export async function signInToCanvas(origin: string, parent?: BrowserWindow): Promise<void> {
  if (await signedIn(origin)) return;
  const win = new BrowserWindow({
    parent,
    width: 560,
    height: 760,
    title: 'Sign in to Canvas',
    autoHideMenuBar: true,
    backgroundColor: '#0d0b14',
    webPreferences: { session: canvasSession(), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.removeMenu();

  return new Promise<void>((resolve, reject) => {
    let done = false;
    let checking = false;
    const finish = async () => {
      done = true;
      await keepSignedIn(origin).catch(() => undefined);
      resolve();
      if (!win.isDestroyed()) win.close();
    };
    // After each page loads, see whether Canvas now knows who you are.
    const check = async () => {
      if (done || checking || win.isDestroyed()) return;
      const url = win.webContents.getURL();
      try {
        const here = new URL(url);
        if (here.origin !== origin || here.pathname.startsWith('/login')) return;
      } catch {
        return;
      }
      checking = true;
      const ok = await signedIn(origin);
      checking = false;
      if (ok) await finish();
    };
    win.webContents.on('did-finish-load', () => void check());
    win.webContents.on('did-navigate-in-page', () => void check());
    win.on('closed', () => {
      if (!done) reject(new Error('The Canvas window was closed before you finished signing in.'));
    });
    win.loadURL(`${origin}/login`).catch(() => {
      if (!done) {
        done = true;
        reject(new Error(`Couldn't open ${new URL(origin).host}. Check the address and your internet connection.`));
        if (!win.isDestroyed()) win.close();
      }
    });
  });
}

/** Forgets the Canvas sign-in (Disconnect). */
export async function signOutOfCanvas(): Promise<void> {
  await canvasSession().clearStorageData();
}
