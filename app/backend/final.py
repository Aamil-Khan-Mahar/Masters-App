"""Final folder: <application>/Final/ holds the final version of everything you upload to that application's portal.

The app fills it from what is already marked final, so nothing is tracked twice:
  - each statement marked final in Apply (README `tasks_done` "essay:<id>"), as a PDF typeset from the draft (essay_pdf)
  - the program's resume once marked final (`tasks_done` "resume"), from <program>/Resume/resume.pdf
  - the transcript PDFs in Common/Transcript, and the score reports in Common/Test-Scores for tests this program asks for

Files the app put there are listed in Final/.final.json; on each update those are refreshed, and removed when their
source stops being final. Anything else in the folder is yours (a signed form, a passport scan) and is never touched.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import essay_pdf
import resume
import store

FOLDER = "Final"
MANIFEST = ".final.json"


def folder(app_id: str) -> Path:
    return store._app_dir(app_id) / FOLDER


def _wants_test(item: dict, name: str) -> bool:
    """Same rule as the Apply to-dos (applyTasks.wantsTest): English tests the program names, the GRE unless it isn't needed."""
    adm = item.get("admission") or {}
    english, gre = str(adm.get("english") or ""), str(adm.get("gre") or "")
    if re.search(r"gre", name, re.I):
        return not gre.strip() or not re.search(r"not (required|accepted|considered|needed)|no gre|isn.t required|does not require", gre, re.I)
    if not english.strip():
        return True
    return bool(re.search(re.escape(name.split()[0]), english, re.I))


def _newer(src: Path, dest: Path) -> bool:
    return not dest.is_file() or src.stat().st_mtime > dest.stat().st_mtime + 1 or src.stat().st_size != dest.stat().st_size


def _plan(item: dict) -> tuple[list[dict], list[dict]]:
    """What belongs in the folder (sources) and what can't be there yet (missing), each with the to-do key it comes from."""
    app_dir = store._app_dir(item["id"])
    done = set(item.get("tasks_done") or [])
    sources: list[dict] = []
    missing: list[dict] = []

    for e in store.essays_for(item):
        key = f"essay:{e['id']}"
        title = (e.get("title") or store.ESSAY_TYPES.get(e.get("type"), "Statement")).strip()
        md = app_dir / f"{store._essay_stem(e['id'])}.md"
        written = md.is_file() and md.read_text(encoding="utf-8").strip()
        if key in done and written:
            pdf = essay_pdf.pdf_path(item["id"], e["id"])
            sources.append({"key": key, "label": title, "name": f"{store._safe_name(title)}.pdf", "src": pdf, "essay": e, "md": md})
        else:
            missing.append({"key": key, "label": title, "why": "Not marked final" if written else "Not written yet"})

    if item.get("kind") == "program":
        pdf = app_dir / resume.FOLDER / "resume.pdf"
        if "resume" in done and pdf.is_file():
            sources.append({"key": "resume", "label": "Resume", "name": "Resume.pdf", "src": pdf})
        else:
            missing.append({"key": "resume", "label": "Resume", "why": "Not marked final" if pdf.is_file() else "Not built yet"})

    transcripts = sorted((store.COMMON / "Transcript").glob("*.pdf")) if (store.COMMON / "Transcript").is_dir() else []
    for pdf in transcripts:
        sources.append({"key": None, "label": "Transcript", "name": pdf.name, "src": pdf})
    if not transcripts:
        missing.append({"key": None, "label": "Transcript", "why": "No PDF in Common/Transcript"})

    reports = sorted((store.COMMON / "Test-Scores").glob("*.pdf")) if (store.COMMON / "Test-Scores").is_dir() else []
    for pdf in reports:
        test = re.split(r"[-_ ]", pdf.stem)[0]
        if test and _wants_test(item, test):
            sources.append({"key": f"score:{test}", "label": f"{test} score report", "name": pdf.name, "src": pdf})
    return sources, missing


def _essay_outdated(s: dict) -> bool:
    """A final statement whose PDF is missing or older than the draft."""
    return "essay" in s and (not s["src"].is_file() or s["md"].stat().st_mtime > s["src"].stat().st_mtime)


def _manifest(dest: Path) -> dict[str, str]:
    try:
        return json.loads((dest / MANIFEST).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def listing(app_id: str, notes: list[str] | None = None) -> dict:
    item = store.get_application(app_id)
    sources, missing = _plan(item)
    dest = folder(app_id)
    managed = _manifest(dest) if dest.is_dir() else {}
    files = []
    if dest.is_dir():
        for f in sorted(dest.iterdir(), key=lambda p: p.name.lower()):
            if f.is_file() and not f.name.startswith("."):
                st = f.stat()
                files.append({"name": f.name, "size": st.st_size, "modified": datetime.fromtimestamp(st.st_mtime).isoformat(timespec="minutes"),
                              "label": managed.get(f.name), "yours": f.name not in managed})
    yours = {f["name"] for f in files if f["yours"]}
    stale = any(name not in {s["name"] for s in sources} for name in managed)
    for s in sources:
        if s["name"] in yours:
            continue
        if _essay_outdated(s) or (s["src"].is_file() and _newer(s["src"], dest / s["name"])):
            stale = True
    return {"folder": dest.relative_to(store.DATA_ROOT).as_posix(), "files": files, "missing": missing, "stale": stale, "notes": notes or []}


def build(app_id: str) -> dict:
    """Bring Final/ up to date: typeset final statements whose PDF is older than the draft, copy every source that changed,
    and drop files the app added earlier whose source is no longer final. Your own files stay."""
    item = store.get_application(app_id)
    sources, _ = _plan(item)
    dest = folder(app_id)
    dest.mkdir(exist_ok=True)
    managed = _manifest(dest)
    notes: list[str] = []
    keep: dict[str, str] = {}
    for s in sources:
        target = dest / s["name"]
        if target.exists() and s["name"] not in managed:
            notes.append(f"Kept your own {s['name']}; the app's copy of {s['label'].lower()} was not added.")
            continue
        if _essay_outdated(s):
            try:
                essay_pdf.build(app_id, s["essay"]["id"], s["essay"].get("title") or s["label"])
            except resume.ResumeError as e:
                notes.append(f"{s['label']}: the PDF could not be made. {e}")
                continue
        if s["src"].is_file() and _newer(s["src"], target):
            shutil.copy2(s["src"], target)
        if target.is_file():
            keep[s["name"]] = s["label"]
    for name in managed:
        if name not in keep and (dest / name).is_file():
            (dest / name).unlink()
    (dest / MANIFEST).write_text(json.dumps(keep, indent=2), encoding="utf-8")
    return listing(app_id, notes)


def file(app_id: str, name: str) -> Path:
    path = store._resolve_inside(folder(app_id), name)
    if not path.is_file() or path.name.startswith("."):
        raise store.NotFound(name)
    return path


def open_folder(app_id: str) -> None:
    """Show the folder in Explorer / Finder on this computer."""
    dest = folder(app_id)
    dest.mkdir(exist_ok=True)
    if sys.platform == "win32":
        os.startfile(dest)  # noqa: S606
    else:
        subprocess.Popen(["open" if sys.platform == "darwin" else "xdg-open", str(dest)])
