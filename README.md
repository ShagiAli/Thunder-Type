# Thunder Type (Web Edition)

A full rewrite of the original Tkinter game as a local web app. Same idea —
type the prompt, track speed/accuracy/combo — completely different, more
robust stack.

- **Refreshing the page keeps you signed in.** Your name is remembered for
  the browser tab (via `sessionStorage`) so reloading just resets your
  current level's attempt instead of sending you back to the sign-in
  screen. Closing the tab/browser clears it, so the next visit starts at
  sign-in again — useful on a shared computer.

## What's in this version

- **Sign-in screen**: on load you enter your name before the game appears.
  Type a name that's played before (autocomplete suggests known names) or a
  new one to start fresh.
- **Every name has fully separate stats.** Best speed, best accuracy, best
  combo, rounds finished, and current level are all tracked per user in a
  real database (SQLite locally, Postgres in production — see "Deploying
  it" below), keyed by a case-insensitive version of their name. "Awab"
  and "Sara" never see or affect each other's numbers.
- **Switch User button** (inside the Profile panel) cleanly signs the
  current player out and returns to the sign-in screen without closing the
  app or losing anything — their progress is saved first.
- **10 levels, easy → hard**: prompts get longer and add punctuation/numbers/
  symbols as you climb. The dot row under the nav shows your progress; the
  "Next Level" button advances you, capping and looping at Level 10 once
  you've maxed out.

## Using it on your phone (same WiFi as your laptop)

When you run `python server.py`, the terminal now prints two URLs:

```
On this computer:  http://127.0.0.1:8000
On your phone/other devices on the same WiFi:  http://192.168.x.x:8000
```

Type that second address into your phone's browser (must be on the same
WiFi network as the laptop running the server). The layout, sign-in screen,
and level-complete popup are all responsive down to phone widths, and the
typing box has `autocorrect`/`autocapitalize`/`spellcheck` disabled so your
phone's keyboard doesn't fight the typing test.

## Run it

Local development needs zero setup — no database to install.

```bash
python server.py
```

Then open **http://127.0.0.1:8000** in your browser.

Everyone's scores are saved automatically to a local `thunder_type.db`
SQLite file next to `server.py` (created on first run) and reloaded next
time you start the server.

## Deploying it

Local SQLite is great for development, but most hosting platforms wipe
the filesystem on every redeploy/restart — so in production you want a
real database that lives outside the app itself.

**This is handled automatically via one environment variable.** Set
`DATABASE_URL` to a Postgres connection string (most PaaS providers give
you this the moment you attach a Postgres add-on) and `server.py` switches
to Postgres with zero code changes — same API, same `main.js`, nothing
else to touch.

1. Deploy to a platform like [Render](https://render.com) or
   [Railway](https://railway.app) — both can run this `server.py` as-is
   (it already reads `PORT` from the environment).
2. Attach their free/starter Postgres add-on. They'll give you a
   `DATABASE_URL` and usually inject it into your app automatically.
3. Install the one production dependency:
   ```bash
   pip install -r requirements.txt
   ```
   (This installs `psycopg2-binary`, the Postgres driver. It's not needed
   at all for local SQLite development — only when `DATABASE_URL` is set.)
4. Deploy. On startup, `server.py` prints which backend it's using:
   ```
   Thunder Type running (storage: postgres)
   ```

Both SQLite and Postgres share the exact same SQL in `server.py` — modern
SQLite and Postgres both support `INSERT ... ON CONFLICT DO UPDATE`, so
there's one code path, not two to maintain.

## Run the tests

```bash
node tests/test_stats.mjs
```

This runs 13 tests against the pure game-logic module (WPM math, accuracy
math, combo build-up/reset, backspace handling, max-combo persistence) using
Node's built-in `assert` — no test framework install required. All 13 pass.

## Why a rewrite instead of patching the Tkinter version

The desktop version kept hitting rendering quirks specific to
`customtkinter` (widgets not drawing until a manual resize, canvas-based
components needing a forced redraw nudge). Those are toolkit bugs, not
things fixable in your code. A browser is a far more mature, heavily-tested
rendering engine — the same class of bug essentially doesn't happen there,
and you get real CSS animations, proper responsive layout, and no install
step for the person running it (just a browser).

## Project layout

```
thunder_type_web/
├── server.py                # backend: static file server + per-user API, SQLite locally / Postgres in production
├── data/
│   └── texts.json           # practice sentences, grouped into 10 levels (easy → hard)
├── thunder_type.db            # local SQLite file, created automatically on first run (not shipped)
├── requirements.txt          # psycopg2-binary — only needed when deploying with Postgres
├── static/                   # everything the browser loads
│   ├── index.html
│   ├── css/
│   │   └── style.css        # all design tokens (colors/fonts/spacing) + components
│   └── js/
│       ├── stats.js         # pure functions: calcWpm, calcAccuracy, calcProgress — zero DOM access
│       ├── gameState.js     # GameState class — combo/timer/round rules, mirrors stats.js's old Python twin
│       ├── api.js           # fetch wrapper for the backend (loadProfile/saveProfile/loadUsers/loadTexts)
│       └── main.js          # DOM wiring only — reads events, calls GameState, updates the page
└── tests/
    └── test_stats.mjs       # 13 tests over stats.js + gameState.js, runnable with plain `node`
```

## API

- `GET /api/profile?name=Awab` — that user's saved stats (fresh defaults if new)
- `POST /api/profile` — upserts one user's record (body must include `player_name`)
- `GET /api/users` — list of all known display names, used for sign-in autocomplete
- `GET /api/texts` — the 10 levels of practice text

## Why this split

- **`stats.js` and `gameState.js` have zero DOM access.** All the actual
  game rules can be tested with plain `node`, no browser needed — that's
  what `tests/test_stats.mjs` does.
- **`main.js` only wires events to state and re-renders.** It never
  computes WPM or accuracy itself — it calls `state.typeChar(...)` and
  paints whatever comes back.
- **`style.css` is the only place colors/fonts live.** Everything is a CSS
  custom property (`--volt`, `--storm`, `--font-mono`, etc.) so re-skinning
  the app means editing tokens in one place, not hunting through markup.
- **Persistence is a tiny JSON API**, same idea as the old `scores.json`
  approach, just served over HTTP instead of read directly from disk by
  the GUI process.

## Design notes

Two accent colors instead of one: **volt-yellow** for speed/energy, **storm-cyan**
for accuracy/calm — mixed together in the progress meter as accuracy changes.
The progress bar itself is clipped into a jagged "voltage" stripe (see
`.voltage-track` / `.voltage-fill` in `style.css`) instead of a plain rounded
bar, and the combo counter flickers briefly on every streak increase.
Typography: Space Grotesk for headings/numbers, Inter for UI text, and
JetBrains Mono for the prompt/typing area — monospace specifically because
it's what you'd actually want while lining up characters to type.

There's a light/dark toggle (`◐` button, top right) — it's in-memory only for
this session; it doesn't persist across reloads.

## If you open `index.html` directly instead of running `server.py`

The game will still work, but scores won't save — the API calls will fail
silently and `main.js` falls back to a small built-in text list. Always run
`python server.py` for the full experience.
