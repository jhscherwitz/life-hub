# Life Hub handoff notes

Read this first if you are picking up Life Hub in a new session. It covers what Hub is, how Jacob likes to work, how the code fits together, what's finished, and what's left.

Last updated: 2026-10-03.

## What Life Hub is

Life Hub is a "life dashboard" desktop app for Mac and Windows. One dark, bold page pulls together your calendar, email, tasks and weather, and each morning it refreshes itself and sends a notification with a daily briefing.

**Name:** Jacob wants it called **Life Hub** everywhere, GitHub included (2026-10-03). PR #11 does the rename (app, installers, website, links). The repo is being renamed from `jhscherwitz/hub-app` to `jhscherwitz/life-hub` (Jacob does that in GitHub Settings), which moves the website to https://jhscherwitz.github.io/life-hub/ and the privacy policy to https://jhscherwitz.github.io/life-hub/privacy.html. Until both land, older paths below may still say Hub / `hub-app`. The app ID stays `com.jhscherwitz.hub`. Keep using the old app data folder (`Hub`) so existing settings and sign-ins survive the rename.

Jacob's goal: a life hub for himself and the people he knows. It must stay **free**. Friends sign in through one shared Google sign-in that is built into release builds. Because that sign-in stays "unverified" (Gmail verification costs money every year), Google caps it at **100 users in total**. That is the plan, not a problem to solve.

Jacob has said there is a lot more to come: more ideas and a better design over time.

## How Jacob likes to work

- **He's a beginner** (this is his second project). Explain every step plainly, one step per line, with exactly what to click or type. Never assume he knows git, npm or GitHub terms.
- **Windows and PowerShell.** PowerShell blocks `npm`, so always tell him `npm.cmd` (for example `npm.cmd install`, `npm.cmd run dev`). His checkout is `C:\Users\jhsch\hub-app`.
- **Dark theme only.** No light theme and no toggle.
- **Bold design.** He wants it to look striking, not "mid".
- **Design (picked 2026-10-03, second round):** a sidebar app (Today, Calendar, Inbox, Tasks, Chat, Settings, plus a Focus link) with rounded night-blue cards over a blurred photo, a blue-violet accent (`#7b5cff`), Unbounded for headings and big numbers and Geist for text. Based on a dark SaaS dashboard he liked. The Today page is **widgets each person arranges** (Customize: add, remove, drag, resize; saved in `userData/dashboard.json`). Earlier looks he rejected: the purple/cyan glow ("vibe coded slop") and the yellow monospace instrument panel.
- **Fully free.** No paid features at all. AI is free only: a free Google Gemini key or a local model (Ollama), chosen in Settings → Free AI. The paid Claude option was removed (2026-10-03). He knows Claude Pro doesn't cover API keys.
- **No paid services.** He declined the Anthropic API key, Apple and Windows code signing, and Google verification. Prefer free options and ask before anything that costs money.
- **No Claude or AI attribution anywhere on GitHub.** No `Co-Authored-By` or `Claude-Session` commit trailers, no "Generated with Claude Code" footers on PRs or comments, no session links, nothing in the README saying an AI made it. He called it "a bad look".
- He's fine with work landing as PRs. He merges them himself or asks for them to be merged.

## Architecture

Electron + React + TypeScript, built with Vite. Tests use Vitest (stay on vitest 3; vitest 4 trips an npm bug).

```
electron/            main process (Node)
  main.ts            app start, windows, tray, IPC handlers (hub:*, settings:*)
  preload.ts         the window.hub API the page uses
  hub.ts             Hub: pulls every source into one DashboardSnapshot; a failing source
                     shows up in `sources` and never breaks the whole page
  sources/           data sources behind the interfaces in types.ts
    index.ts         createSources(): the one place that picks real vs sample data
    sample.ts        sample data for anything not connected yet
    weather.ts       Open-Meteo (free, no key)
    tasks.ts         Hub's own task list (userData/tasks.json)
  google/            Google sign-in (loopback OAuth + PKCE), Calendar, Gmail
    builtin.ts       reads google-client.json, the shared client baked into release builds
  ai/                free AI only: Gemini (free key from aistudio.google.com) or Ollama (local).
                     Picked in Settings → Free AI. No paid AI anywhere.
  smart/             briefing, email triage, Gmail drafts, inbox summary, chat, wrap-up.
                     Uses the free AI if it's on; otherwise simple non-AI versions run
  morning.ts         morning update: checks every minute and on wake/unlock, catches up later
                     that day, remembers the last run in userData/morning.json
  updater.ts         electron-updater auto-update from public GitHub Releases (Windows only
                     in practice; Mac needs a paid Apple ID)
  settings.ts        settings, secrets encrypted with safeStorage (userData/settings.json)
  tray.ts, notes.ts  tray / menu bar countdown, quick-capture notes
src/renderer/        React page: Dashboard, SettingsPanel, WrapUpPanel, Capture (global shortcut)
src/shared/          types and logic shared by both sides (focus.ts = the "Now" card)
test/                Vitest tests
docs/                GitHub Pages site: index.html and privacy.html
.github/workflows/   ci.yml (typecheck, tests, build on every PR), release.yml (installers)
```

Data lives in the user's `userData/Hub` folder. The dev copy and the installed copy share it, and a single-instance lock means `npm.cmd run dev` just focuses an installed Hub that is already running.

Releases: pushing a `v*` tag runs `release.yml`, which builds a Windows `.exe` (NSIS) and a universal Mac `.dmg`/`.zip` and attaches them to a **draft** GitHub Release. Nothing goes public until someone clicks **Publish release**. The workflow writes `google-client.json` from the repo secrets `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Signing switches on by itself if signing secrets are ever added (they won't be, since it costs money).

Running checks: `npm.cmd run typecheck`, `npm.cmd test`, `npm.cmd run build`.

## What's done

| Step | PR | What it added |
| --- | --- | --- |
| 1. App shell | #1 | Electron + React + TS, dashboard, tray countdown, Now card, quick capture |
| 2. Real data | #2 | Google Calendar + Gmail, weather, commute, built-in tasks. Jacob's real calendar and email work (2026-10-02) |
| 3. Smart layer | #3 | Daily briefing, Now card logic, email triage with Gmail draft replies, evening wrap-up |
| 4. Morning update | #5 | Morning refresh + notification, start at login (installed app only) |
| Installers | #6 | Windows and Mac installers, release workflow, auto-update, shared Google sign-in from secrets |
| Website | #9 | Home page and privacy policy at https://jhscherwitz.github.io/hub-app/ |
| Settings fix | #8 | Settings no longer crashes when Hub is updated while running |
| Redesign | #15 | Instrument-panel look over a blurred photo, day view popup (D key) |
| Background + focus | #16 | Pick your own background in Settings; Focus 25 min timer (F key) with tray countdown and a "Focus done" notification |
| No commute, new look, widgets | #17 | Jacob called commute "a stupid feature" (2026-10-03): removed everywhere. Don't bring commute back. Also the sidebar redesign and customizable widgets |
| Free AI, chat, inbox summaries | #18 | Claude removed; free Gemini key or Ollama in Settings → Free AI. Chat page, Inbox page with an AI overview and one line per email, Focus timer is a widget (no big header button) |
| Focus opens LockedIn | #19 | Life Hub's own focus timer is gone. The Focus widget, the sidebar Focus link and the F key open Jacob's other site, LockedIn (https://jhscherwitz.github.io/lockedin/), his focus timer with Pomodoro, brain breaks and study together |
| Daily tasks widget (the sky) | #20 | The same few tasks every day, reset at midnight. Each task is a star in a small night sky; ticking one lights it, lines between lit stars glow, and all done shows "Constellation complete". Each row has a 7-day dot strip and a streak. Edit renames, deletes and adds (up to 8). Saved in `habits.json` in the app data folder. Logic in `src/shared/habits.ts`; old saved layouts need Customize, Add widget, Daily tasks |
| Tidy grid, no title bar, Dashboard button | (this PR) | Widgets now have set shapes like a phone home screen: widths in quarters (S ¼, M ½, W ¾, F full) and heights of one or two 118px rows, so rows always line up; extra content scrolls inside the card. Old saved layouts keep their sizes but M is now a half, so Reset in Customize gives the new default. The window has no title bar or File/Edit menu on Windows and Linux (min/max/close are drawn over the top right); macOS keeps its traffic lights. "Today" is now a big Dashboard button at the top of the sidebar |

The repo is **public** (Jacob approved it so the website, downloads and auto-update work for free).

## What's left

### Open PRs at handoff

- **#7 Redesign the dashboard look:** the bold dark redesign (glowing background, frosted cards, big clock, stat tiles, custom fonts). Bringing main into it has one conflict, in package.json: keep both the two `@fontsource-variable/*` packages and `electron-updater`, then run `npm install` to refresh the lockfile. With that, typecheck, tests and build pass (checked 2026-10-03). Waiting on Jacob's go-ahead to merge.
- **#11 Rename the app to Life Hub:** Jacob renames the repo to `life-hub` first, then merges #11 once its checks pass.
- **#4 Fix the Google setup steps in the README:** a 6-line README fix. Waiting on Jacob's go-ahead to merge.

Before/after screenshots of the redesign are in the project files (`redesign/before.png`, `redesign/after.png`).

### Jacob's own hands (only he can do these)

He is in the middle of these in the "Make Hub downloadable" thread. Pick up wherever he stopped:

1. **Finish Google's sign-in screen** in the Google Cloud project **Hub Public** (once the repo is renamed, use `life-hub` instead of `hub-app` in these links):
   - On **Branding**, set Application home page to `https://jhscherwitz.github.io/hub-app/`, privacy policy to `https://jhscherwitz.github.io/hub-app/privacy.html`, and add `jhscherwitz.github.io` under Authorized domains. Save.
   - On **Audience**, click **Publish app**, then **Confirm**. Don't submit for verification; it stays unverified (free, 100 users).
2. **Make the shared key:** Clients → Create client → Desktop app, name `Hub`.
3. **Add it to GitHub:** repo Settings → Secrets and variables → Actions → New repository secret, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
4. **Publish the first version:** in PowerShell in `C:\Users\jhsch\hub-app`, run `git pull`, `npm.cmd version patch`, `git push --follow-tags`. When the Actions run finishes, open **Releases**, check the draft, click **Publish release**, and send friends the Releases link. (A session can do the tag push for him, but publishing the release needs his word.)
5. Optional: his own Google project ("Life Hub") is still in **Testing**, so it signs him out about weekly. Once the shared client is live he can use the installed release instead.

What friends will see: Windows says "Windows protected your PC" (More info → Run anyway); Mac needs System Settings → Privacy & Security → Open Anyway; Google says "Google hasn't verified this app" (Advanced → Go to Hub). Mac copies can't auto-update without Apple's $99/year ID, so Mac friends download new versions by hand.

### Ideas Jacob approved that aren't built yet

All the extras he approved early on are built (tray countdown, Now card, email triage with drafts, weather, evening wrap-up, quick capture). He has said more ideas and a better design are coming, so ask him what's next rather than guessing.

## Rules for the next session

- Never publish a GitHub Release, make anything cost money, or change Google Cloud settings without Jacob's word.
- Call the app **Life Hub** in anything new.
- Keep everything dark and bold.
- Every commit and PR: no AI attribution lines (see above).
- When Jacob has to do something, give numbered steps with exact clicks and `npm.cmd` commands.

## Reference guides

These were written for Jacob during the project and are summarised above:

- Google setup for your own Google project: the README's **Connect your accounts** section.
- Free sharing checklist: shared unverified Google client, public repo, publish a release (steps above).
- Paid options, if he ever wants to remove the warnings or the 100-user cap: Google verification with Gmail needs a yearly security assessment (about $540 to $3,000+), Apple Developer ID is $99/year, Windows signing is about $120/year. He has said no to all of these for now.
