# Masters App

A local, dark-mode dashboard for running a whole master's application cycle: find programs, shortlist them, track every application, line up recommenders, and get coaching on your statement of purpose.

All data lives in plain Markdown files in `data/` (git-ignored by this repo), so it works with git and stays readable without the app. Setup is in the [top-level README](../README.md).

## Run it

```bash
python app/start.py
```

The first run creates a Python virtualenv, installs packages and builds the UI. It needs Python 3.11+ and Node.js 20+. The app then opens at http://127.0.0.1:8000.

Options:
- `--port 8001` to use a different port.
- `--no-browser` to skip opening a browser tab.
- `--local-only` to stop it listening on the home network (no phone access).
- `--once` to exit quietly if it's already running (used by the autostart task).

**Start with Windows:** run `app/autostart/install.ps1` once from an administrator PowerShell. It adds two scheduled tasks: "Masters app" starts the server at boot, before anyone logs in (also at logon and every 5 minutes if it has stopped; output goes to `app/.local/autostart.log`), and "Masters VS Code" opens this folder in VS Code when you log in. `uninstall.ps1` removes both.

**On your phone:** start.py also prints a link like `http://192.168.x.x:8000`. Open it on a phone on the same Wi-Fi. There is no login, so anyone on that network can open the app. Windows Firewall must allow inbound TCP 8000 on that network.
- `--rebuild` to force a fresh UI build.

### AI features

Research, fit scoring and the SOP coach need Claude. The app can reach it in two ways:

- **Claude subscription (default).** If Claude Code is installed and logged in (run `claude` once in a terminal), the app runs it headless (`claude -p`) in the background. Nothing is billed separately; calls count toward your plan's usage limits.
- **Anthropic API.** Copy `app/.env.example` to `app/.env` and set `ANTHROPIC_API_KEY`. Calls are billed per token, and the cost of every call is logged and shown in the sidebar and on the Profile page.

When both are available, the API is used. Set `AI_BACKEND=claude-code` or `AI_BACKEND=api` in `app/.env` to force one. Without either, everything except those three features still works.

## Pages

The app has three areas that never overlap. A switch at the top moves between Research and Apply; the initials button opens You from either.

**Research** decides where to apply.

| Page | What it does |
|---|---|
| Desk | What still needs research, what has gone stale, your shortlist, deadlines coming up on programs you haven't started |
| Discover | Describe what you want and Claude searches the web for programs or scholarships |
| Applications | Programs being researched or shortlisted, as cards, a board or a ranked comparison. Dropping a card on Applying (or pressing Start applying on its page) hands it to Apply |
| Scholarships | External funding, same rule |
| Costs | What each program costs against its funding, and your card charges |
| Agent Town | Every AI task is an agent; watch them, call them back, browse finished jobs |

**Apply** gets the applications done, for anything Preparing or later.

| Page | What it does |
|---|---|
| Up next | What closes next, the next step for each application, what's due in 30 days |
| Applications | Mail-style: applications and smart folders (Documents, Score sends, Fees, Supervisors) on the left, one application's to-dos in the middle, the open to-do on the right. Essays open as a full-page editor with the coach behind a button. Each program also has a read-only page (Program, Faculty, Funding, Notes) |
| Letters | Every recommender against every application, with a ready-to-paste request email |
| Calendar | Deadlines for what you're applying to, plus your test dates |
| Outcomes | Interviews, decisions and your answer |

**You**: Profile (read by every AI feature), Tests, Files.

## Data layout

```
<data root>/
├── Common/
│   ├── Profile.md                       # created from the Profile page
│   ├── Recommenders/<Name>/Info.md      # one folder per recommender
│   ├── Resume/master-resume/content-files/*.tex   # read as AI context
│   ├── Test-Scores/Test-Scores.md
│   └── Transcript/
└── Applications/
    ├── Programs/<Country>/<University>/<Program>/
    │   ├── README.md        # YAML frontmatter = tracked fields, body = notes + research
    │   ├── SOP.md           # your draft
    │   └── SOP-Coach.md     # coach feedback, newest first
    └── Scholarships/<Name>/README.md
```

The data root defaults to `data/` beside `app/`, which the repo's `.gitignore` excludes. Set `DATA_ROOT` in `app/.env` to point it somewhere else (relative paths count from the repo root). The app only ever reads or writes `Common/`, `Applications/` and its own history in `.app/` (usage log, agent history, saved searches).

On first run, when the data root doesn't exist yet, the app shows a setup screen that creates it, optionally seeded from `app/sample-data/` and as its own private git repo. It refuses to create it anywhere the app's own repo would track it.

## Development

```bash
# terminal 1: API with auto-reload
cd app/backend && ../.venv/Scripts/python -m uvicorn main:app --reload --port 8000
# terminal 2: UI with hot reload at http://localhost:5173 (proxies /api to :8000)
cd app/frontend && npm run dev
```

- `backend/store.py`: the file data layer (frontmatter read/write, defaults).
- `backend/ai.py`: all Claude calls and prompts.
- `backend/main.py`: the API, background AI jobs and static UI serving.
- `frontend/src/pages/`: one file per page.
