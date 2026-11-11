# Masters

A local web app for running a whole master's application cycle: find programs, research and shortlist them, track every application, line up recommenders, tailor your resume and get coaching on your statements. It runs on your own computer and keeps everything in plain Markdown files.

## Your data stays yours

This repo is **only the app**. Everything about you lives in a `data/` folder that git ignores, so pulling updates, sharing the app or opening a pull request can never include it.

```
Masters/                  ← this repo: code only, safe to share
├── app/                  the app (backend, frontend, example data)
├── scripts/              one-off maintenance scripts
├── README.md             you are here
└── data/                 ← YOUR folder, ignored by this repo
    ├── Common/           profile, resumes, transcript, test scores, recommenders
    ├── Applications/     one folder per program and scholarship
    ├── Private/          passwords and anything else that must never leave your computer
    └── .app/             the app's history: usage, AI agent logs, saved searches
```

`data/` is created for you on first run. You can make it its own private git repo (the setup screen offers this) so it's backed up separately from the app.

## Setup

You need:
- **Python 3.11+** and **Node.js 20+** (for the first build of the UI)
- **git**
- For the AI features, either **Claude Code** logged in (run `claude` once in a terminal; uses your Claude subscription) or an **Anthropic API key**. Without either, everything except research, scoring and coaching still works.
- Optional: **[Tectonic](https://tectonic-typesetting.github.io/)** to compile tailored resumes and essays to PDF.

Then:

```bash
git clone <this repo's URL> Masters
cd Masters
python app/start.py
```

The first start creates a Python virtualenv, installs packages and builds the UI (a few minutes). After that it starts in seconds and opens http://127.0.0.1:8000.

**In the app**, a setup screen asks where your data should live (`data/` by default), whether to start empty or with a made-up example program to explore, and whether to make the folder its own git repo. Then it takes you to your **Profile**: fill that in first, because every AI feature reads it. After that, use **Discover** to find programs.

### AI and other settings (optional)

Copy `app/.env.example` to `app/.env` (never committed) to:
- set `ANTHROPIC_API_KEY` to use the paid API instead of your Claude subscription,
- pick models or how many AI agents run at once,
- put your data somewhere other than `data/` with `DATA_ROOT`.

Restart the app after changing it.

### Useful start options

`python app/start.py --port 8001` (another port), `--no-browser`, `--local-only` (don't listen on your Wi-Fi; by default your phone on the same network can open it, with no login). On Windows, `app/autostart/install.ps1` starts it with the computer. Details in [app/README.md](app/README.md).

## Backing up your data

If you let setup make `data/` a git repo, back it up to a **private** remote:

```bash
cd data
git add -A && git commit -m "My applications"
git remote add origin https://github.com/<you>/<private-repo>.git   # create it as Private
git push -u origin main
```

`data/.gitignore` keeps `Private/` and `.app/` out of that repo too.

## Updating the app

```bash
git pull
python app/start.py   # rebuilds whatever changed
```

Your `data/` folder isn't touched.

## Sharing or contributing

Anything you commit in this repo is code. Before pushing, `git status` should never list `data/`, `app/.env` or anything with your name in it. To double-check that your data is ignored:

```bash
git check-ignore -v data/Common/Profile.md   # prints the .gitignore rule that covers it
```

When changing the app, keep it generic: nothing about a particular person (names, schools, file paths, dates) in code, prompts or docs. Example content goes in `app/sample-data/`, which is fictional. See [CLAUDE.md](CLAUDE.md) and [app/README.md](app/README.md) for how the app is built.

## Coming from the old layout?

If your personal folders (`Common/`, `Applications/`, `Private/`) sit at the top level next to `app/` in one git repo, `scripts/migrate-to-data-folder.ps1` moves them, and that repo's history, into `data/`, then makes this folder a fresh app-only repo. Run it with `-DryRun` first; it explains each step and stops if anything looks off.
