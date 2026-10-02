# Hub

A personal life dashboard for Mac and Windows, with a dark theme. One page that pulls your calendar, email, tasks and weather together, with a menu bar / tray countdown to your next meeting and a global shortcut for capturing tasks and notes from anywhere.

![Hub dashboard](docs/screenshot.png)

> **Status:** app shell running on sample data. Real Google Calendar, Gmail, tasks and weather are next, followed by the written morning briefing, email triage with draft replies, and the evening wrap-up.

## Run it on your computer

You only need to do steps 1 and 2 once.

**1. Install Node.js.** Go to [nodejs.org](https://nodejs.org), download the version marked **LTS**, and run the installer. Click through with the default options.

**2. Download Hub.** Open a terminal:

- **Mac:** press ⌘ Space, type `Terminal`, and press Enter.
- **Windows:** press the Windows key, type `PowerShell`, and press Enter.

Then copy and paste these lines one at a time, pressing Enter after each:

```bash
git clone https://github.com/jhscherwitz/hub-app.git
cd hub-app
npm install
```

The last one takes a minute or two. If your computer says `git` isn't installed, a Mac will offer to install it for you (click **Install**); on Windows, install it from [git-scm.com](https://git-scm.com) and open a new PowerShell window.

**3. Start Hub.** In the same terminal, type:

```bash
npm run dev
```

The dashboard opens in its own window. Leave the terminal open while you use it.

**Next time**, open a terminal and run:

```bash
cd hub-app
npm run dev
```

**To stop Hub**, click its icon in the menu bar (Mac) or system tray (Windows) and choose **Quit Hub**, or press Ctrl+C in the terminal.

**To get the latest version** after changes are made, run `git pull` and then `npm install` inside the `hub-app` folder before `npm run dev`.

<details>
<summary>More commands (for later)</summary>

| Command | What it does |
| --- | --- |
| `npm start` | Builds everything and runs the finished version. |
| `npm run typecheck` | Checks the code for type errors. |
| `npm run package:mac` | Builds a Mac app (`.dmg`) into `release/`. Run it on a Mac. |
| `npm run package:win` | Builds a Windows installer into `release/`. Run it on Windows. |

The built apps aren't signed yet, so the first time you open one, macOS will ask you to right-click → **Open**, and Windows will ask you to click **More info → Run anyway**.

</details>

## Using it

- **Dashboard.** The *Now* card shows the meeting you're in (with a Join button) or, if you're free, your top task and how long until your next meeting. Below it: weather and commute, the daily briefing, today's calendar, emails that need a reply, and your tasks.
- **Menu bar / tray.** On macOS the next meeting and a live countdown sit in the menu bar ("Product sync in 25m"). On Windows the countdown is in the tray icon's tooltip and menu; click the icon to open the dashboard. Closing the window keeps Hub running there; use **Quit Hub** from the menu to exit.
- **Quick capture.** Press **⌘⇧Space** (Mac) or **Ctrl+Shift+Space** (Windows) anywhere. Type, then **Enter** to save. **Tab** switches between task and note, **Esc** closes. If another app already owns that shortcut, Hub falls back to **⌘⌥Space** / **Ctrl+Alt+Space**; the dashboard header shows which one is active.

Captured tasks, checkbox state and notes are saved in Hub's app data folder, so they survive restarts.

## How it's built

[Electron](https://www.electronjs.org) + [React](https://react.dev) + TypeScript, bundled with [Vite](https://vite.dev).

```
electron/
  main.ts          windows, global shortcut, IPC, refresh timer
  tray.ts          menu bar / tray icon and countdown
  preload.ts       the safe `window.hub` API the UI talks to
  hub.ts           pulls every source into one DashboardSnapshot
  notes.ts         local store for captured notes
  sources/
    types.ts       the data-source interfaces
    sample.ts      sample implementations
    index.ts       createSources(): picks which implementation backs each source
src/
  shared/          types and time helpers used by both sides
  renderer/        the React dashboard and the quick-capture window
assets/            tray and app icons
```

### Adding a real data source

All data flows through five interfaces in `electron/sources/types.ts`: `CalendarSource`, `EmailSource`, `TaskSource`, `WeatherSource` and `CommuteSource`. To connect a real service, implement the matching interface (for example a `GoogleCalendarSource` with `listEvents()`), then return it from `createSources()` in `electron/sources/index.ts`. The UI, tray and briefing don't change.

Sources run in the Electron main process, so API keys and OAuth tokens never reach the web page. If one source throws, its section comes back empty, the dashboard shows which source failed, and everything else still loads.
