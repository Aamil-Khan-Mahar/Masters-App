"""Per-program resumes: a copy of the master resume, cut to a page limit by removing and reordering whole entries.

The master is never edited. Its section files are split into verbatim chunks (preamble, one chunk per entry,
postamble); a plan says which chunks to keep and in what order, and the files are rebuilt by joining those chunks.
Claude chooses the plan (ai.resume_plan) without writing LaTeX. The one exception is a per-program edit you ask for
(ai.resume_edit, "shorten this entry"): it replaces that entry's chunk for this program only, is checked by
check_edit before it's used, and lives in the README's `resume_edits`, so it can be reverted at any time.

Layout written beside the program's README:
  Resume/            the master folder's files, with content.tex and the section files re-assembled
  Resume/resume.pdf  compiled with Tectonic, checked against the page limit
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import threading
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

import store

MASTER = store.COMMON / "Resume" / "master-resume"
MAX_PAGES = 3
FOLDER = "Resume"

_INPUT = re.compile(r"^\s*\\input\{content-files/([^}]+)\}\s*$")
_ENTRY = re.compile(r"^\s*\\resume(Subheading|ProjectHeading)\b")
_LIST_END = re.compile(r"^\s*\\resumeSubHeadingListEnd\b")
_SECTION = re.compile(r"\\section\{([^}]*)\}")
_SKIP = {"resume.pdf", "resume.log", "resume.aux", "resume.out", "resume.synctex.gz", "resume.fls", "resume.fdb_latexmk"}


class ResumeError(Exception):
    pass


# One build at a time per application: builds share the Resume.building folder.
_locks: defaultdict[str, threading.Lock] = defaultdict(threading.Lock)


# ---------------------------------------------------------------- parsing

def _sections(folder: Path) -> list[str]:
    """Section file stems in content.tex order (Header included)."""
    lines = (folder / "content.tex").read_text(encoding="utf-8").splitlines()
    return [m.group(1) for line in lines if (m := _INPUT.match(line))]


def _split(text: str) -> tuple[str, list[str], str]:
    """A section file as (preamble, [entry chunks], postamble). Joining them gives back the file exactly."""
    lines = text.splitlines(keepends=True)
    starts = [i for i, line in enumerate(lines) if _ENTRY.match(line)]
    end = next((i for i, line in enumerate(lines) if _LIST_END.match(line)), None)
    if not starts or end is None or end < starts[-1]:
        return text, [], ""
    bounds = starts + [end]
    entries = ["".join(lines[a:b]) for a, b in zip(bounds, bounds[1:])]
    return "".join(lines[: starts[0]]), entries, "".join(lines[end:])


def master() -> dict:
    """The master resume as sections of entries, each with an id and its verbatim LaTeX."""
    if not (MASTER / "content.tex").is_file():
        raise ResumeError(f"No master resume at {MASTER}")
    sections = []
    for stem in _sections(MASTER):
        text = (MASTER / "content-files" / f"{stem}.tex").read_text(encoding="utf-8")
        pre, entries, post = _split(text)
        title = (_SECTION.search(text) or [None, stem])[1] if stem != "Header" else "Header"
        sections.append({
            "id": stem,
            "title": title.replace("\\&", "&"),
            "pre": pre, "post": post, "text": text,
            "entries": [{"id": f"{stem}.{i + 1}", "tex": e} for i, e in enumerate(entries)],
        })
    return {"sections": sections}


def entry_title(tex: str) -> str:
    """First heading argument of an entry, as plain text."""
    m = re.search(r"\\resume(?:Subheading|ProjectHeading)\s*\{((?:[^{}]|\{[^{}]*\})*)\}", tex)
    title = m.group(1) if m else tex[:60]
    title = re.sub(r"\\[a-zA-Z]+\{([^}]*)\}", r"\1", title).replace("\\&", "&").replace("--", "–")
    return re.sub(r"\s+", " ", title.replace("{", "").replace("}", "")).strip()


def outline() -> list[dict]:
    """The master's sections and entries (id, title and LaTeX), for picking them by hand and comparing edits with."""
    return [
        {"id": s["id"], "title": s["title"], "tex": s["text"] if not s["entries"] else "",
         "entries": [{"id": e["id"], "title": entry_title(e["tex"]), "tex": e["tex"]} for e in s["entries"]]}
        for s in master()["sections"] if s["id"] != "Header"
    ]


# ---------------------------------------------------------------- per-program edits

_FORBIDDEN = re.compile(r"\\(input|include|write|immediate|openout|openin|read|catcode|def|let|newcommand|renewcommand|usepackage|documentclass|end\{document)|\\resumeSubHeadingList(Start|End)")


def _balanced(tex: str) -> bool:
    depth = 0
    for i, c in enumerate(tex):
        if c in "{}" and i and tex[i - 1] == "\\":
            continue
        depth += 1 if c == "{" else -1 if c == "}" else 0
        if depth < 0:
            return False
    return depth == 0


def check_edit(original: str, new: str) -> str | None:
    """Why an edited chunk can't be used, or None if it keeps the original's shape (same entry macro or section heading,
    balanced braces, matching bullet lists, nothing that could run commands)."""
    new = new.strip("\n") + "\n"
    if _FORBIDDEN.search(new):
        return "it uses LaTeX commands an entry shouldn't"
    if re.search(r"</?chunk", new):
        return "it has stray markup in it"
    if not _balanced(new):
        return "its braces don't balance"
    head = _ENTRY.match(original.lstrip("\n"))
    if head and not re.match(r"^\s*\\resume" + head.group(1) + r"\b", new.lstrip("\n")):
        return "it changed the kind of entry"
    sec = _SECTION.search(original)
    if sec and sec.group(0) not in new:
        return "it changed the section heading"
    if new.count("\\resumeItemListStart") != new.count("\\resumeItemListEnd"):
        return "its bullet list isn't closed"
    return None


def with_edits(doc: dict, edits: dict | None) -> dict:
    """The master with this program's edited chunks swapped in: entries by entry id, one-block sections by section id."""
    if not edits:
        return doc
    for s in doc["sections"]:
        for e in s["entries"]:
            if e["id"] in edits:
                e["tex"] = edits[e["id"]]
        if not s["entries"] and s["id"] in edits:
            s["text"] = edits[s["id"]]
            s["edited"] = True
    return doc


def chunks(plan: list[dict], edits: dict | None) -> list[dict]:
    """The kept entries (and one-block sections) as they currently read for this program: id, title, LaTeX, edited."""
    doc = with_edits(master(), edits)
    by_id = {s["id"]: s for s in doc["sections"]}
    out = []
    for p in plan:
        s = by_id.get(p["id"])
        if not s or s["id"] == "Header":
            continue
        if not s["entries"]:
            out.append({"id": s["id"], "title": s["title"], "tex": s["text"], "edited": s["id"] in (edits or {})})
        for e in s["entries"]:
            if e["id"] in p["entries"]:
                out.append({"id": e["id"], "title": entry_title(e["tex"]), "tex": e["tex"], "edited": e["id"] in (edits or {})})
    return out


# ---------------------------------------------------------------- plans

def clean_plan(plan: dict, doc: dict) -> dict:
    """Keep only known ids, each once, entries within their own section. Header always comes first.
    Sections and entries the plan leaves out are removed. Returns {sections: [{id, entries}], cut_order: [...]}."""
    by_id = {s["id"]: s for s in doc["sections"]}
    seen: set[str] = set()
    out = []
    for s in plan.get("sections") or []:
        sid = s.get("id")
        if sid not in by_id or sid == "Header" or sid in seen:
            continue
        seen.add(sid)
        own = {e["id"] for e in by_id[sid]["entries"]}
        if own:
            keep = list(dict.fromkeys(e for e in s.get("entries") or [] if e in own))
            if keep:
                out.append({"id": sid, "entries": keep})
        else:
            out.append({"id": sid, "entries": []})  # a whole-block section (skills, languages)
    if "Header" in by_id:
        out.insert(0, {"id": "Header", "entries": []})
    kept = {e for s in out for e in s["entries"]}
    cut = list(dict.fromkeys(e for e in plan.get("cut_order") or [] if e in kept))
    return {"sections": out, "cut_order": cut}


def without(plan: dict, entry_id: str) -> dict:
    sections = []
    for s in plan["sections"]:
        if entry_id in s["entries"]:
            rest = [e for e in s["entries"] if e != entry_id]
            if rest:
                sections.append({**s, "entries": rest})
        else:
            sections.append(s)
    return {"sections": sections, "cut_order": [e for e in plan["cut_order"] if e != entry_id]}


# ---------------------------------------------------------------- building

def _write(folder: Path, plan: dict, doc: dict, label: str) -> None:
    """Rewrite content.tex and the kept section files in `folder` (a fresh copy of the master) from verbatim chunks."""
    by_id = {s["id"]: s for s in doc["sections"]}
    for s in plan["sections"]:
        sec = by_id[s["id"]]
        if not sec["entries"]:
            if sec.get("edited"):  # a one-block section (skills) edited for this program
                (folder / "content-files" / f"{s['id']}.tex").write_text(sec["text"], encoding="utf-8", newline="")
            continue
        tex = {e["id"]: e["tex"] for e in sec["entries"]}
        (folder / "content-files" / f"{s['id']}.tex").write_text(
            sec["pre"] + "".join(tex[e] for e in s["entries"]) + sec["post"], encoding="utf-8", newline="")

    lines = (MASTER / "content.tex").read_text(encoding="utf-8").splitlines()
    idx = [i for i, line in enumerate(lines) if _INPUT.match(line)]
    inputs = []
    for s in plan["sections"]:
        inputs.append(f"\\input{{content-files/{s['id']}}}")
        if s["id"] == "Header":
            inputs.append("")
    note = [
        f"% PROGRAM RESUME: {label}. Built {date.today().isoformat()} by the Masters app from master-resume.",
        "% Whole entries and sections were removed or reordered; edits you asked for are in the README's resume_edits. Rebuilding replaces this folder.",
        "%",
    ]
    out = note + lines[: idx[0]] + inputs + lines[idx[-1] + 1:]
    (folder / "content.tex").write_text("\n".join(out) + "\n", encoding="utf-8")


def tectonic() -> str | None:
    found = os.environ.get("TECTONIC") or shutil.which("tectonic")
    if found:
        return found
    for base in (Path.home() / "anaconda3", Path.home() / "miniconda3", Path.home() / "miniforge3"):
        exe = base / "envs" / "tectonic" / "Library" / "bin" / "tectonic.exe"
        if exe.is_file():
            return str(exe)
    return None


def compile_pages(folder: Path) -> int:
    exe = tectonic()
    if not exe:
        raise ResumeError("Tectonic isn't installed, so the resume can't be compiled. Install it, or set TECTONIC to its path.")
    try:
        proc = subprocess.run([exe, "-X", "compile", "resume.tex"], cwd=folder, capture_output=True, text=True,
                              timeout=300, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except subprocess.TimeoutExpired as e:
        raise ResumeError("LaTeX took too long to compile.") from e
    pdf = folder / "resume.pdf"
    if proc.returncode != 0 or not pdf.is_file():
        tail = "\n".join((proc.stderr or proc.stdout or "").strip().splitlines()[-6:])
        raise ResumeError(f"LaTeX failed to compile:\n{tail}")
    from pypdf import PdfReader
    return len(PdfReader(str(pdf)).pages)


def build(app_id: str, plan: dict, label: str, report=lambda text: None, max_pages: int = MAX_PAGES, edits: dict | None = None) -> dict:
    """Copy the master beside the application, apply `plan` (and this program's `edits`), compile, and cut entries in
    `cut_order` until it fits."""
    with _locks[app_id]:
        return _build(app_id, plan, label, report, max_pages, edits)


def pick(app_id: str, sections: list[dict], label: str, edits: dict | None = None) -> dict:
    """Build exactly the sections and entries you ticked, in your order, with no automatic cuts."""
    return build(app_id, {"sections": sections, "cut_order": []}, label, edits=edits)


def _build(app_id: str, plan: dict, label: str, report, max_pages: int, edits: dict | None) -> dict:
    doc = with_edits(master(), edits)
    plan = clean_plan(plan, doc)
    dest = store._app_dir(app_id) / FOLDER
    work = dest.with_name(FOLDER + ".building")
    shutil.rmtree(work, ignore_errors=True)
    shutil.copytree(MASTER, work, ignore=lambda d, names: [n for n in names if n in _SKIP])

    titles = {e["id"]: entry_title(e["tex"]) for s in doc["sections"] for e in s["entries"]}
    auto_cut: list[str] = []
    try:
        while True:
            _write(work, plan, doc, label)
            report("Compiling the PDF")
            pages = compile_pages(work)
            if pages <= max_pages or not plan["cut_order"]:
                break
            nxt = plan["cut_order"][0]
            report(f"{pages} pages, cutting {titles[nxt]}")
            auto_cut.append(nxt)
            plan = without(plan, nxt)
    except Exception:
        shutil.rmtree(work, ignore_errors=True)
        raise

    for s in doc["sections"]:  # drop the files of sections that were removed, so the folder shows what's in it
        if s["id"] not in {p["id"] for p in plan["sections"]}:
            (work / "content-files" / f"{s['id']}.tex").unlink(missing_ok=True)
    shutil.rmtree(dest, ignore_errors=True)
    work.rename(dest)

    kept = {e for s in plan["sections"] for e in s["entries"]}
    by_id = {s["id"]: s for s in doc["sections"]}
    return {
        # What was kept, by id, so the picker can show it ticked.
        "plan": [{"id": s["id"], "entries": s["entries"]} for s in plan["sections"] if s["id"] != "Header"],
        "built_on": date.today().isoformat(),
        "built_at": datetime.now().isoformat(timespec="seconds"),
        "pages": pages,
        "max_pages": max_pages,
        "fits": pages <= max_pages,
        "sections": [
            {"id": s["id"], "title": by_id[s["id"]]["title"], "entries": [titles[e] for e in s["entries"]]}
            for s in plan["sections"] if s["id"] != "Header"
        ],
        "removed": [
            {"section": s["title"], "title": titles[e["id"]], "auto": e["id"] in auto_cut}
            for s in doc["sections"] for e in s["entries"] if e["id"] not in kept
        ] + [
            {"section": s["title"], "title": "Whole section", "auto": False}
            for s in doc["sections"] if not s["entries"] and s["id"] not in {p["id"] for p in plan["sections"]}
        ],
    }


def pdf_path(app_id: str) -> Path:
    path = store._app_dir(app_id) / FOLDER / "resume.pdf"
    if not path.is_file():
        raise store.NotFound(f"{app_id}/{FOLDER}/resume.pdf")
    return path
