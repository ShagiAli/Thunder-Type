# ⚡ Thunder Type

A fast-paced typing practice game — 10 difficulty levels, per-user
password-protected accounts, and an admin dashboard. Built as a small,
dependency-light web app: a Python standard-library backend and vanilla
JavaScript on the frontend, no framework, no build step.

![Backend](https://img.shields.io/badge/backend-Python%20stdlib-3776AB?logo=python&logoColor=white)
![Frontend](https://img.shields.io/badge/frontend-vanilla%20JS-F7DF1E?logo=javascript&logoColor=black)
![Database](https://img.shields.io/badge/database-SQLite%20%2F%20PostgreSQL-4169E1?logo=postgresql&logoColor=white)
![Tests](https://img.shields.io/badge/tests-13%20passing-brightgreen)

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Playing on Your Phone](#playing-on-your-phone)
- [Deployment](#deployment)
- [Admin Access](#admin-access)
- [Project Structure](#project-structure)
- [API Reference](#api-reference)
- [Running Tests](#running-tests)
- [Design Notes](#design-notes)
- [FAQ](#faq)

## Features

- **Password-protected accounts.** A new name creates an account with
  whatever password is typed; an existing name requires the matching
  password. No one can view or overwrite someone else's stats just by
  typing their name. Passwords are hashed with PBKDF2-HMAC-SHA256
  (standard library only) and never stored or logged in plaintext.
- **Fully separate stats per user** — best speed, best accuracy, best
  combo, rounds finished, and current level — tracked in a real database
  and keyed by a case-insensitive version of each name.
- **10 levels, easy → hard.** Prompts get longer and add punctuation,
  numbers, and symbols as you climb, with 6 rotating prompts per level (60
  total) so it doesn't feel repetitive. A dot row tracks your progress;
  "Next Level" only unlocks once the current level is actually finished.
- **Admin dashboard** (`/admin.html`) — a leaderboard of every player
  sorted by best WPM, with per-user delete and password-reset controls.
  Gated by a separate admin password, completely independent of any
  player account.
- **Refresh-safe sessions.** Reloading the page keeps you signed in for
  that browser tab and just resets your current level's attempt — it
  doesn't send you back to the sign-in screen.
- **Responsive, phone-friendly, low-noise design.** Works down to phone
  widths, with an interactive canvas background on sign-in and a subtle
  ambient version on the main game screen.

## Quick Start

No database to install — local development works out of the box.

```bash
python server.py
```

Then open **http://127.0.0.1:8000**. Everyone's scores are saved
automatically to a local `thunder_type.db` SQLite file next to
`server.py` (created on first run).

> **Note:** opening `static/index.html` directly (instead of running
> `server.py`) still lets the game work, but nothing will save — the API
> calls fail silently and the app falls back to a small built-in text list.

## Playing on Your Phone

When you run `python server.py`, the terminal prints two URLs:

```
On this computer:                              http://127.0.0.1:8000
On your phone/other devices on the same WiFi:  http://192.168.x.x:8000
```

Enter the second URL on your phone's browser — it must be on the same
WiFi network as the computer running the server. The layout, sign-in
screen, and level-complete popup are all responsive down to phone widths,
and the typing box has `autocorrect`/`autocapitalize`/`spellcheck`
disabled so the phone keyboard doesn't fight the typing test.

## Deployment

Local SQLite is fine for development, but most hosting platforms wipe the
filesystem on every redeploy — so production needs a database that lives
outside the app itself. This is handled by **one environment variable**:

Set `DATABASE_URL` to a Postgres connection string and `server.py`
switches from SQLite to Postgres automatically — same code, same API,
nothing else to touch. Modern SQLite and Postgres both support
`INSERT ... ON CONFLICT DO UPDATE`, so it's one SQL code path, not two.

**Steps** (using [Render](https://render.com) or
[Railway](https://railway.app), both of which run `server.py` as-is):

1. Push this project to a GitHub repo.
2. Create a Web Service pointing at that repo.
   - **Build command:** `pip install -r requirements.txt`
   - **Start command:** `python server.py`
3. Create a Postgres instance and copy its **Internal Database URL**.
4. Add it as an environment variable on the web service:
   | Key | Value |
   |---|---|
   | `DATABASE_URL` | *(the Internal Database URL from step 3)* |
5. Deploy. The startup log confirms which backend is active:
   ```
   Thunder Type running (storage: postgres)
   ```

`requirements.txt` only contains `psycopg2-binary` — the Postgres driver.
It's not needed at all for local SQLite development, only once
`DATABASE_URL` is set.

If the deploy fails right after a successful build, `server.py` prints a
clear diagnostic (missing/wrong `DATABASE_URL`, wrong region, etc.)
instead of a raw crash — check the deploy logs for that message first.

## Admin Access

Reach the admin dashboard two ways:

- Directly: `/admin.html` (e.g. `https://your-app.onrender.com/admin.html`)
- Or click **Admin** in the top-right corner of the main sign-in screen

It's gated by a separate `ADMIN_PASSWORD` environment variable —
completely independent of any player's password.

> **If `ADMIN_PASSWORD` isn't set, the admin page is entirely
> non-functional** (every request returns 503) rather than falling back
> to any default or blank password.

**To enable it:**

```bash
# macOS/Linux
ADMIN_PASSWORD=your-strong-secret python server.py
```
```powershell
# Windows PowerShell
$env:ADMIN_PASSWORD="your-strong-secret"; python server.py
```

On Render/Railway: add `ADMIN_PASSWORD` as another environment variable
on the web service, the same way you added `DATABASE_URL`.

From the dashboard you can view every player's stats as a leaderboard,
delete an account entirely, or reset a forgotten password (stats aren't
touched by a reset). The admin password is kept in memory only for that
browser tab — refreshing the admin page requires logging in again,
intentionally stricter than the game's own refresh-safe sessions.

**Migrating from an earlier passwordless version?** The first time each
existing name signs in after upgrading, whatever password is typed
becomes that account's password going forward — existing stats are
preserved, not reset.

## Project Structure

```
thunder_type_web/
├── server.py                  # backend: static file server + player API + admin API
├── requirements.txt           # psycopg2-binary — only needed when deploying with Postgres
├── data/
│   └── texts.json             # practice prompts, 6 per level × 10 levels (easy → hard)
├── static/                    # everything the browser loads
│   ├── index.html             # the game
│   ├── admin.html             # the admin dashboard
│   ├── css/
│   │   ├── style.css          # all design tokens + game page components
│   │   └── admin.css          # admin page layout, reuses style.css's tokens
│   └── js/
│       ├── main.js            # DOM wiring for the game page
│       ├── admin.js           # DOM wiring for the admin page
│       ├── api.js             # fetch wrapper for every backend endpoint
│       ├── gameState.js       # combo/timer/round rules
│       ├── stats.js           # pure WPM/accuracy/progress math — zero DOM access
│       ├── signinBackground.js   # interactive canvas background (sign-in screens)
│       └── ambientBackground.js  # passive canvas background (main game screen)
└── tests/
    └── test_stats.mjs         # 13 tests over stats.js + gameState.js
```

## API Reference

| Method | Endpoint | Body | Description |
|---|---|---|---|
| `POST` | `/api/auth` | `{player_name, password}` | Creates an account if the name is new; logs in if it exists and the password matches. `401` on wrong password. |
| `POST` | `/api/save` | `{player_name, password, ...stats}` | Saves stats. Requires the correct password (`401` if wrong). |
| `GET` | `/api/texts` | — | Returns all 10 levels of practice text. |
| `POST` | `/api/admin/users` | `{admin_password}` | Every user's stats as a leaderboard, sorted by best WPM. `503` if admin access isn't configured, `401` if the password is wrong. |
| `POST` | `/api/admin/delete-user` | `{admin_password, player_name}` | Permanently deletes an account. |
| `POST` | `/api/admin/reset-password` | `{admin_password, player_name, new_password}` | Sets a new password without touching that user's stats. |

## Running Tests

```bash
node tests/test_stats.mjs
```

Runs 13 tests against the pure game-logic module — WPM math, accuracy
math, combo build-up/reset, backspace handling, no-repeat prompt
selection, max-combo persistence — using Node's built-in `assert`. No
test framework install required.

## Design Notes

<details>
<summary><strong>Why a web app instead of the original Tkinter desktop version</strong></summary>

<br>

The desktop version kept hitting rendering quirks specific to
`customtkinter` — widgets not drawing until a manual resize, canvas-based
components needing a forced redraw nudge. Those are toolkit bugs, not
things fixable in application code. A browser is a far more mature,
heavily-tested rendering engine: the same class of bug essentially
doesn't happen there, plus real CSS animations, responsive layout for
free, and no install step for whoever's playing — just a browser.

</details>

<details>
<summary><strong>Why the code is split the way it is</strong></summary>

<br>

- **`stats.js` and `gameState.js` have zero DOM access.** All the actual
  game rules — WPM/accuracy math, combo build-up, round completion — can
  be tested with plain `node`, no browser needed. That's what
  `tests/test_stats.mjs` does.
- **`main.js` only wires events to state and re-renders.** It never
  computes WPM or accuracy itself; it calls `state.typeChar(...)` and
  paints whatever comes back.
- **`style.css` is the only place colors/fonts live.** Everything is a
  CSS custom property (`--volt`, `--storm`, `--font-mono`, etc.), so
  re-skinning the app means editing tokens in one place, not hunting
  through markup.
- **SQLite and Postgres share one SQL code path** in `server.py` rather
  than two separately-maintained ones (see [Deployment](#deployment)).

</details>

<details>
<summary><strong>Visual design</strong></summary>

<br>

Two accent colors instead of one: **volt-yellow** for speed/energy,
**storm-cyan** for accuracy/calm, mixed together in the progress meter as
accuracy changes. The progress bar itself is clipped into a jagged
"voltage" stripe (`.voltage-track` / `.voltage-fill` in `style.css`)
rather than a plain rounded bar, and the combo counter flickers briefly
on every streak increase.

Typography: Space Grotesk for headings/numbers, Inter for UI text,
JetBrains Mono for the prompt/typing area — monospace specifically
because that's what you'd actually want while lining up characters to
type.

A light/dark toggle (◐ button, top right) is available but in-memory
only — it doesn't persist across reloads.

</details>

## FAQ

**Scores aren't saving — what's wrong?**
Make sure you're running the app via `python server.py`, not by opening
`static/index.html` directly. Opening the file directly means every API
call fails and nothing persists.

**Can two people play from different devices?**
Yes — see [Playing on Your Phone](#playing-on-your-phone). Any device on
the same WiFi (or, once deployed, anywhere on the internet) can sign in
with its own name and password, fully isolated from every other account.

**I forgot my password.**
Ask whoever has `ADMIN_PASSWORD` to reset it from `/admin.html` — resets
don't touch existing stats.

**Do I need to know Postgres to deploy this?**
No — see [Deployment](#deployment). It's one environment variable; the
code handles the rest.
