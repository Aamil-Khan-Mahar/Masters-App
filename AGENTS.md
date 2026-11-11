# Getting this app running (for AI assistants)

You are helping someone set up and run **Masters**, a local web app for a master's application cycle. Follow these steps in order, check each one, and tell the person what you did. Architecture and coding rules are in `CLAUDE.md`; people-facing setup is in `README.md`.

## Ground rules

- This repo is code only. The person's own data lives in `data/` (or wherever `DATA_ROOT` in `app/.env` points), which git ignores. Never commit, print or upload anything from it.
- Never open or read `data/Private/`.
- Never put API keys or passwords in code, prompts or commits. `app/.env` is git-ignored; keys go there and nowhere else.
- Don't hardcode anything about the person (name, schools, dates, paths) in the app. Personal context goes in `data/CLAUDE.md`, loaded through a git-ignored `CLAUDE.local.md` containing `@data/CLAUDE.md`.

## 1. Check the prerequisites

Run these and install whatever is missing (ask before installing system software):

| Need | Check | Notes |
|---|---|---|
| Python 3.11+ | `python --version` (or `python3`) | Required. |
| Node.js 20+ and npm | `node --version` | Required for the first UI build. |
| git | `git --version` | Required. |
| Claude Code CLI, logged in | `claude --version`, then `claude` once to log in | One of these two powers the AI features (research, scoring, coaching). |
| or an Anthropic API key | goes in `app/.env` as `ANTHROPIC_API_KEY` | Billed per token; used instead of Claude Code when set. |
| Tectonic (optional) | `tectonic --version` | Compiles tailored resumes and essays to PDF. Found on PATH, via the `TECTONIC` env var, or in a conda env named `tectonic`. |

Without Claude Code or an API key, the app still runs, but the AI features don't.

## 2. Configure (optional)

```bash
cp app/.env.example app/.env
```

Every setting is optional: `ANTHROPIC_API_KEY`, `AI_BACKEND` (`auto` | `claude-code` | `api`), model names, `AGENTS_MAX`, and `DATA_ROOT` (defaults to `data/`). If `DATA_ROOT` points inside this repo anywhere other than `data/`, add it to `.gitignore`. Skip this step to use Claude Code and `data/`. `start.py` prints a note when `app/.env` is missing; with Claude Code logged in, the AI features still work.

## 3. Start it

```bash
python app/start.py
```

- The first run creates `app/.venv`, installs `app/backend/requirements.txt`, runs `npm install` and builds the UI. This takes a few minutes. Later runs start in seconds and rebuild the UI only when its sources change.
- It serves http://127.0.0.1:8000 (or the next free port) and opens a browser tab. It also prints a phone link for the same Wi-Fi. That link has no login, so use `--local-only` on shared networks.
- Options: `--port 8001`, `--no-browser`, `--local-only`, `--rebuild`, `--once`.
- When the person says "start it up", run it in the background and report the URL.
- Check that it works: `curl -s http://127.0.0.1:8000/api/applications` should return JSON, and the page should load.

## 4. First run in the browser

Until the data root has `Common/` and `Applications/`, the app shows only a setup screen. It asks:
1. Where the data lives (`data/` by default).
2. Whether to start empty or seed the fictional example from `app/sample-data/`.
3. Whether to make the data folder its own git repo. Recommend yes, with a **private** remote, as described under "Backing up your data" in `README.md`.

Then the person should fill in **Profile** first, because every AI feature reads it. After that, **Discover** finds programs.

## 5. Optional extras

- **Research MCP server** (Semantic Scholar and arXiv for faculty research inside Claude Code sessions): `cd .claude/mcp-servers/academic-research && npm install`. `.mcp.json` registers it.
- **Start with Windows:** run `app/autostart/install.ps1` from an administrator PowerShell (it expects Python at `%USERPROFILE%\anaconda3`, so edit `$Python` there if that differs). `uninstall.ps1` removes it.
- **Updating:** `git pull`, then `python app/start.py`. The data folder is never touched.

## Troubleshooting

- `npm` not found: install Node.js 20+, then rerun with `--rebuild`.
- Backend packages are broken: delete `app/.venv` and start again.
- The AI features fail: run `claude` in a terminal to check you're logged in, or check `ANTHROPIC_API_KEY` in `app/.env`, then restart the app.
- Resume or essay PDFs fail: install Tectonic or set `TECTONIC` to its path.
- Port in use: `start.py` picks the next free port and prints it.

## Before you commit to this repo

Check that `git status` lists nothing from `data/`, no `app/.env` and nothing with the person's name, schools or dates in it. Example content belongs in `app/sample-data/`, which is fictional.
