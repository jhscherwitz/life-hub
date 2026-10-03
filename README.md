# Life Hub

A personal life dashboard for Mac and Windows, with a dark theme. One page that pulls your calendar, email, tasks and weather together, with a menu bar / tray countdown to your next meeting and a global shortcut for capturing tasks and notes from anywhere.

![Life Hub dashboard](docs/screenshot.png)

> **Status:** connects to Google Calendar and Gmail, real weather, and has its own task list. Claude writes a daily briefing, picks out the emails that need a reply and drafts replies for you, and the evening wrap-up rolls unfinished items into tomorrow. Each morning Life Hub updates itself and sends a notification with your briefing. Anything you haven't connected yet shows sample data.

## Download Life Hub

Download the newest installer from the [Releases page](https://github.com/jhscherwitz/life-hub/releases): `Life-Hub-Setup-….exe` for Windows, `Life-Hub-…-mac.dmg` for Mac. Life Hub updates itself after that: when a new version is out it downloads in the background and asks you to restart.

Life Hub isn't code-signed yet, so the first time you open it:

- **Windows** shows **Windows protected your PC**. Click **More info**, then **Run anyway**.
- **Mac:** open the `.dmg` and drag **Life Hub** into **Applications**. Open Life Hub; when macOS says it can't check it for malicious software, click **Done**, open **System Settings → Privacy & Security**, scroll down and click **Open Anyway** next to Life Hub.

## Run it from the code

You only need to do steps 1 and 2 once.

**1. Install Node.js.** Go to [nodejs.org](https://nodejs.org), download the version marked **LTS**, and run the installer. Click through with the default options.

**2. Download Life Hub.** Open a terminal:

- **Mac:** press ⌘ Space, type `Terminal`, and press Enter.
- **Windows:** press the Windows key, type `PowerShell`, and press Enter.

Then copy and paste these lines one at a time, pressing Enter after each:

```bash
git clone https://github.com/jhscherwitz/life-hub.git
cd life-hub
npm install
```

On Windows, if PowerShell says running scripts is disabled, type `npm.cmd` wherever these steps say `npm`. The last one takes a minute or two. If your computer says `git` isn't installed, a Mac will offer to install it for you (click **Install**); on Windows, install it from [git-scm.com](https://git-scm.com) and open a new PowerShell window.

**3. Start Life Hub.** In the same terminal, type:

```bash
npm run dev
```

The dashboard opens in its own window. Leave the terminal open while you use it.

**Next time**, open a terminal and run:

```bash
cd life-hub
npm run dev
```

**To stop Life Hub**, click its icon in the menu bar (Mac) or system tray (Windows) and choose **Quit Life Hub**, or press Ctrl+C in the terminal.

**To get the latest version** after changes are made, run `git pull` and then `npm install` inside the `life-hub` folder before `npm run dev`.

## Install Life Hub so it starts by itself

Running Life Hub from the terminal is fine for trying it out, but it stops when you close the terminal and can't start when you log in. The easiest fix is the installer from [Download Life Hub](#download-hub). To build the installer yourself from the code instead, follow these steps. They are for Windows; on a Mac use `npm run package:mac` and open the `.dmg` instead.

1. If Life Hub is running, right-click its tray icon and choose **Quit Life Hub**.
2. Open PowerShell, then copy and paste these lines one at a time, pressing Enter after each:

   ```powershell
   cd life-hub
   npm.cmd run package:win
   ```

   This takes a few minutes and builds an installer.
3. Open the `release` folder inside `life-hub` (in File Explorer: your user folder → `life-hub` → `release`) and double-click **Life-Hub-Setup-0.1.0.exe** (the number is Life Hub's version).
4. Windows will say **Windows protected your PC**, because the installer isn't signed. Click **More info**, then **Run anyway**.
5. Life Hub installs and opens. It's now in your Start menu, and it starts in the tray each time you log in. Your settings and Google sign-in carry over.

To turn this off, untick **Start Life Hub in the tray when I log in** in **Settings → Morning update**.

**After an update**, quit Life Hub from the tray, run `git pull` and `npm.cmd install` in the `life-hub` folder, then repeat steps 2 to 5 to install the new version. (A copy installed from the Releases page updates itself.)

**Working on Life Hub from the terminal** while the installed one is running? Quit the installed one from the tray first, or `npm.cmd run dev` will just bring the installed one to the front.

## Connect your accounts

Everything is set up from **Settings** (top right of the dashboard). Until a section is connected, it shows sample data, and the header shows a **Some sample data** badge.

### Google Calendar and Gmail

If Settings shows only a **Sign in with Google** button, Google sign-in is built into your copy of Life Hub: click it and skip to step 18. Otherwise, follow these steps.

Life Hub signs in to Google itself, so Google needs to know about it first. You do this once, in Google Cloud, and it's free. It takes about 10 minutes. Use the same Google account your calendar and Gmail are on.

**A. Make a project**

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and sign in. If it asks you to agree to the terms, tick the box and click **Agree and continue**.
2. At the top left, click the project picker (it says **Select a project**), then **New project**.
3. For **Project name**, type `Life Hub` (Google needs at least 4 letters; the name is only a label). Click **Create**.
4. When it's done, click the project picker again and choose **Life Hub**, so it's the selected project for the next steps.

**B. Turn on the Calendar and Gmail APIs**

5. Open the [Google Calendar API page](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com) and click **Enable**.
6. Open the [Gmail API page](https://console.cloud.google.com/apis/library/gmail.googleapis.com) and click **Enable**.

**C. Set up the sign-in screen**

7. Open [Google Auth Platform](https://console.cloud.google.com/auth/overview) and click **Get started**.
8. **App name:** `Life Hub`. **User support email:** pick your email. Click **Next**.
9. **Audience:** choose **External**. Click **Next**.
10. **Contact information:** type your email. Click **Next**.
11. Tick the box to agree, then click **Continue** and **Create**.
12. In the left menu, click **Audience**. Under **Test users**, click **Add users**, type your Gmail address, and click **Save**.
13. Still on **Audience**, click **Publish app**, then **Confirm**. This keeps you signed in. If you skip it, Google signs Life Hub out once a week and you'll need to click **Sign in with Google** again. If Google asks about verification, you don't need it: Life Hub is only for you.

**D. Create Life Hub's key**

14. In the left menu, click **Clients**, then **Create client**.
15. **Application type:** choose **Desktop app**. **Name:** `Life Hub`. Leave the box about an AI-powered agent unticked. Click **Create**.
16. A box shows your **Client ID** and **Client secret**. Keep this box open. Google only shows the secret once (if you lose it, open the client and click **Add secret**).

**E. Sign in from Life Hub**

17. In Life Hub, click **Settings**. Paste the **Client ID** and **Client secret** into the boxes and click **Save**.
18. Click **Sign in with Google**. Your web browser opens.
19. Choose your Google account. Google will say **Google hasn't verified this app**. That's expected, because it's your own app: click **Continue** (or, if you only see **Back to safety**, click **Advanced** and then **Go to Life Hub**).
20. Tick **every** box (see your calendar, read your email, and manage drafts), then click **Continue**.
21. The browser says **You're signed in**. Close the tab and go back to Life Hub. Your real calendar and inbox appear within a few seconds.

Life Hub reads your calendar and email, and saves draft replies in Gmail when you click **Draft reply**. Google's wording for the draft permission is "manage drafts and send emails", but Life Hub never sends anything: drafts wait in your Gmail **Drafts** folder until you send them yourself. Your sign-in is stored encrypted on your computer and never leaves it. To disconnect, click **Sign out** in Settings.

**Signed in before draft replies were added?** Life Hub needs the new draft permission once. In **Settings**, click **Sign out**, then **Sign in with Google**, and tick every box. Until then the dashboard shows a reminder.

### Claude (AI writing)

Claude writes your daily briefing, decides which emails need a reply, drafts replies, and sums up your evening wrap-up. It's optional: without it, Life Hub writes simpler versions itself and everything still works.

Claude needs an Anthropic API key. You pay Anthropic for what Life Hub uses, which for one person is a few cents a day (a rough estimate; your Anthropic account shows the real figure).

1. Go to [console.anthropic.com](https://console.anthropic.com) and sign up (or sign in).
2. In the left menu, click **Billing** and add some credit. $5 is plenty to start.
3. In the left menu, click **API keys**, then **Create key**. Name it `Life Hub` and click **Create**.
4. Click **Copy**. Anthropic only shows the key once.
5. In Life Hub, open **Settings**. Under **Claude (AI writing)**, paste the key and click **Save**. Life Hub checks the key with Anthropic first, then stores it encrypted on your computer.

To make this work, Life Hub sends your calendar, task titles and the emails it's working on to Anthropic. To turn Claude off, click **Remove key** in Settings.

### Weather

In **Settings → Weather**, type your town, click **Search**, and click the right result. Weather comes from [Open-Meteo](https://open-meteo.com), which is free and needs no account.

### Tasks

Life Hub has its own task list. Add tasks from the box at the top of the Tasks card, or from anywhere with quick capture. Tick a task to complete it; hover over it and click **×** to delete it.

<details>
<summary>More commands (for later)</summary>

| Command | What it does |
| --- | --- |
| `npm start` | Builds everything and runs the finished version. |
| `npm run typecheck` | Checks the code for type errors. |
| `npm test` | Runs the automated tests. |
| `npm run package:mac` | Builds a Mac app (`.dmg`) into `release/`. Run it on a Mac. |
| `npm run package:win` | Builds a Windows installer into `release/`. Run it on Windows. |

The built apps aren't signed yet, so the first time you open one, macOS will ask you to right-click → **Open**, and Windows will ask you to click **More info → Run anyway**.

</details>

<details>
<summary>Publishing a new version (for Jacob)</summary>

GitHub builds the Windows and Mac installers for you. In PowerShell, inside the `life-hub` folder, on the `main` branch:

1. `git pull`
2. `npm.cmd version patch` (this bumps 0.1.0 to 0.1.1; use `minor` for 0.2.0). It saves the new number and makes a version tag.
3. `git push --follow-tags`
4. Open the repo's **Actions** tab and wait for **Build installers** to go green.
5. Open **Releases**. There's a **Draft** with both installers attached. Click the pencil, write a line about what changed, and click **Publish release**. Installed copies of Life Hub pick it up within a few hours.

Code signing turns on by itself once the signing secrets are added to the repo (Settings → Secrets and variables → Actions): `MAC_CERTIFICATE`, `MAC_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` for Mac, and `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET` (plus the variables `AZURE_SIGNING_ENDPOINT`, `AZURE_SIGNING_ACCOUNT`, `AZURE_CERT_PROFILE` and `AZURE_PUBLISHER_NAME`) for Windows. Without them, builds still work, unsigned. To build Life Hub's own Google sign-in into releases, add its Client ID and secret as the secrets `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

</details>

## Using it

- **Morning update.** Each morning at 7:00 AM Life Hub refreshes everything, writes your briefing and shows a notification with the day's headline. Click it to open the dashboard. If your computer is asleep or off at that time, the update runs as soon as you're back. Change the time in **Settings → Morning update**, or click **Run it now** to try it. If no notification appears on Windows, check that **Do not disturb** is off and that Life Hub is allowed under **Settings → System → Notifications**.
- **Daily briefing.** At the top: a one-line summary of the day and a few points on what matters (when to leave, who's waiting on a reply, which task to start with, anything carried over from last night). With Claude, it's written once each morning; click **Rewrite** for a fresh one. Without Claude, Life Hub's quick summary shows instead.
- **Now.** The meeting you're in (with a **Join call** button), when to leave for your next in-person event, a call that starts in the next 10 minutes, or otherwise your top task (overdue first, then due today) with how long you're free. Click **Mark done** to tick it off.
- **Needs a reply.** Only the emails that need an answer from you: from a person, in your Primary inbox, and not already replied to. With Claude, it reads each one and decides, with a short reason; without it, Life Hub shows the unread ones. Click **Draft reply** and the reply is saved in Gmail's **Drafts**, threaded under the original. Life Hub never sends it: open Gmail, check it, and send it yourself. Click an email to open it in Gmail.
- **Evening wrap-up.** Click **Wrap up the day** (it lights up after 5 PM). Life Hub lists what you finished and what's still open. Untick anything you want to drop, add a note for tomorrow, and click **Finish the day**. Ticked tasks move to tomorrow, and everything you kept shows up in tomorrow morning's briefing.
- **Menu bar / tray.** On macOS the next meeting and a live countdown sit in the menu bar ("Product sync in 25m"). On Windows the countdown is in the tray icon's tooltip and menu; click the icon to open the dashboard. Closing the window keeps Life Hub running there; use **Quit Life Hub** from the menu to exit.
- **Quick capture.** Press **⌘⇧Space** (Mac) or **Ctrl+Shift+Space** (Windows) anywhere. Type, then **Enter** to save. **Tab** switches between task and note, **Esc** closes. If another app already owns that shortcut, Life Hub falls back to **⌘⌥Space** / **Ctrl+Alt+Space**; the dashboard header shows which one is active.

Tasks, notes, wrap-ups and settings are saved in Life Hub's app data folder, so they survive restarts.

## How it's built

[Electron](https://www.electronjs.org) + [React](https://react.dev) + TypeScript, bundled with [Vite](https://vite.dev).

```
electron/
  main.ts          windows, global shortcut, IPC, refresh timer, start at login, notifications
  morning.ts       the daily morning update: schedule and catch-up after sleep
  tray.ts          menu bar / tray icon and countdown
  preload.ts       the safe `window.hub` API the UI talks to
  hub.ts           pulls every source into one DashboardSnapshot
  notes.ts         local store for captured notes
  settings.ts      settings file; secrets encrypted with the OS keychain
  updater.ts       auto-update from GitHub Releases (installed copies only)
  http.ts          fetch helper (timeouts, readable errors)
  google/
    auth.ts        Google sign-in (OAuth + PKCE via the browser), token refresh
    builtin.ts     the Google client built into release builds (google-client.json)
    calendar.ts    Google Calendar source
    gmail.ts       Gmail source: inbox, reading a message, saving drafts
  smart/
    index.ts       SmartLayer: briefing, triage, drafts and wrap-up, with or without Claude
    claude.ts      Claude API client (key from Settings)
    briefing.ts    the daily briefing (Claude's and Life Hub's basic one)
    triage.ts      which emails need a reply
    drafts.ts      draft replies
    wrapup.ts      the evening wrap-up and what carries over
  sources/
    types.ts       the data-source interfaces
    sample.ts      sample implementations (used until something is connected)
    weather.ts     Open-Meteo weather and place search
    tasks.ts       Life Hub's own task list
    index.ts       createSources(): picks which implementation backs each source
src/
  shared/          types, time helpers and the Now card's logic, used by both sides
  renderer/        the React dashboard, Settings and the quick-capture window
test/              automated tests (npm test)
assets/            tray and app icons
```

### Adding a real data source

All data flows through four interfaces in `electron/sources/types.ts`: `CalendarSource`, `EmailSource`, `TaskSource` and `WeatherSource`. To connect another service, implement the matching interface, then return it from `createSources()` in `electron/sources/index.ts`. That function runs again whenever settings change, so it can choose between the real source and the sample one. The UI, tray and briefing don't change.

Sources run in the Electron main process, so API keys and OAuth tokens never reach the web page. If one source throws, its section comes back empty, the dashboard shows which source failed, and everything else still loads.
