"""File-backed data layer.

Everything the app knows about its user lives in plain files under the data
root (`data/` beside `app/` unless DATA_ROOT says otherwise). The app's own git
repo ignores that folder, so the code can be shared without the data:

    Common/                      personal, reusable material
        Profile.md               frontmatter = structured profile, body = free text
        Recommenders/<slug>/Info.md
        Resume/, Test-Scores/, Transcript/
    Applications/
        Programs/<Country>/<University>/<Program>/README.md
        Scholarships/<Name>/README.md
    .app/                        the app's own history (usage, agents, searches)

Each application README.md holds structured fields in YAML frontmatter and
free-form notes / research in the markdown body. SOP drafts sit next to it
as SOP.md. Nothing outside Common/, Applications/ and .app/ is ever read or
written (Private/ in particular is off limits).
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
from datetime import date, datetime
from pathlib import Path
from typing import Any

import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
SAMPLE_DATA = REPO_ROOT / "app" / "sample-data"


def _data_root() -> Path:
    """DATA_ROOT from app/.env (relative paths count from the repo root), else data/ beside app/."""
    configured = os.environ.get("DATA_ROOT", "").strip()
    if not configured:
        return (REPO_ROOT / "data").resolve()
    path = Path(configured).expanduser()
    return (path if path.is_absolute() else REPO_ROOT / path).resolve()


DATA_ROOT = _data_root()
COMMON = DATA_ROOT / "Common"
APPLICATIONS = DATA_ROOT / "Applications"
PROGRAMS = APPLICATIONS / "Programs"
SCHOLARSHIPS = APPLICATIONS / "Scholarships"
PROFILE = COMMON / "Profile.md"
RECOMMENDERS = COMMON / "Recommenders"
APP_STATE = DATA_ROOT / ".app"

STAGES = ["researching", "shortlisted", "preparing", "submitted", "interview", "decision", "final", "dropped"]
DROPPED = "dropped"  # "Not considering": archived, but one stage change away from coming back
DECISIONS = ["admitted", "waitlisted", "rejected"]
RESPONSES = ["accepted", "declined"]
REC_STATUSES = ["planned", "requested", "reminded", "submitted"]

PROGRAM_CHECKLIST = [
    "Statement of purpose",
    "Resume / CV",
    "Transcripts",
    "English test scores",
    "Letters of recommendation",
    "Application fee paid",
    "Application submitted",
]
SCHOLARSHIP_CHECKLIST = [
    "Eligibility confirmed",
    "Essays",
    "Resume / CV",
    "Transcripts",
    "Letters of recommendation",
    "Application submitted",
]

COMMON_DEFAULTS: dict[str, Any] = {
    "name": "",
    "country": "",
    "url": "",
    "stage": "researching",
    "decision": None,
    "response": None,
    "archived": False,
    "deadlines": [],  # [{label, date (YYYY-MM-DD), done}]
    "requirements": [],  # [str]
    "checklist": [],  # [{item, done}]
    "portal": {"url": "", "username": ""},
    "recommenders": [],  # [{id, status, requested_on, submitted_on, notes}]
    "expenses": [],  # [{label, amount, currency, paid, date}]
    "sources": [],  # [str urls]
    "researched_on": None,
}

PROGRAM_DEFAULTS: dict[str, Any] = {
    **COMMON_DEFAULTS,
    "kind": "program",
    "university": "",
    "city": "",
    "degree": "",
    "intake": "",
    "duration": "",
    "tuition": "",  # human-readable, e.g. "CAD 9,000 / year"
    "tuition_usd_per_year": None,
    "living_usd_per_year": None,
    "funding": "",
    "faculty": [],  # contacts you track: [{name, email, research, contacted_on, status, notes}]
    "overview": "",
    "format": "",
    "structure": "",
    "courses": [],
    "admission": {},  # {gpa, english, gre, background, prerequisites, documents, letters, notes}
    "faculty_profiles": [],  # from research / directory: [{name, title, department, research, why, url, accepting, match}]
    "funding_details": {},  # {summary, guaranteed, typical_package, typical_package_usd_per_year, assistantships, awards[], external[], notes}
    "funding_researched_on": None,
    "faculty_source_url": "",  # the program's faculty or supervisor directory page
    "faculty_researched_on": None,
    "labs": [],  # [{name, focus, url}]
    "outcomes": "",
    "sop_prompt": "",
    "comment": "",  # your own overall take on the program, written by you
    "scores": {},  # {fit, cost, admit, career (0-10), tier, rationale, scored_on}
    "course_check": {},  # your courses vs the official requirements: {verdict, summary, requirements[], gaps, actions, sources, checked_on}
    "requirements_check": {},  # summary of Requirements.md (the full checklist): {verdict, items, done, counts, checked_on}
    "scholarships": [],  # [application ids]
}

SCHOLARSHIP_DEFAULTS: dict[str, Any] = {
    **COMMON_DEFAULTS,
    "kind": "scholarship",
    "provider": "",
    "coverage": "",
    "eligibility": [],
    "overview": "",
    "selection": [],
    "awards_per_year": "",
    "programs": [],  # [application ids] this scholarship could fund
}

PROFILE_DEFAULTS: dict[str, Any] = {
    "name": "",
    "email": "",
    "nationality": "",
    "current_role": "",
    "undergrad": {"university": "", "degree": "", "gpa": "", "scale": "", "graduated": ""},
    "interests": [],
    "goals": "",
    "target_countries": [],
    "target_intake": "",
    "degree_types": [],
    "budget_usd_per_year": None,
    "funding_need": "",  # full / partial / none
    "shortlist_weights": {"fit": 35, "cost": 25, "admit": 20, "career": 20},
    # The currency your card is in (ISO code). Foreign fees cost the day's rate plus the bank's
    # foreign-transaction fee, plus any tax charged on that fee.
    "home_currency": "USD",
    "card_charges": {"fx_fee_pct": 0, "tax_on_fee_pct": 0},
}


class NotFound(Exception):
    pass


# Agents write to the same README in parallel; hold this around any read-modify-write.
WRITE_LOCK = threading.RLock()


# ---------------------------------------------------------------- file helpers

def _json_safe(value: Any) -> Any:
    """YAML parses bare dates into date objects; the API wants strings."""
    if isinstance(value, (date, datetime)):
        return value.isoformat()[:10]
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_json_safe(v) for v in value]
    return value


def read_doc(path: Path) -> tuple[dict, str]:
    text = path.read_text(encoding="utf-8")
    if text.startswith("---"):
        parts = re.split(r"^---\s*$", text, maxsplit=2, flags=re.M)
        if len(parts) == 3:
            meta = yaml.safe_load(parts[1]) or {}
            return _json_safe(meta), parts[2].lstrip("\n")
    return {}, text


def write_doc(path: Path, meta: dict, body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    front = yaml.safe_dump(meta, sort_keys=False, allow_unicode=True, width=1000)
    content = f"---\n{front}---\n\n{body.strip()}\n"
    # Atomic replace so a crash never leaves a half-written file.
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)
    os.replace(tmp, path)


def _safe_name(name: str) -> str:
    name = re.sub(r'[<>:"/\\|?*]', "-", name).strip(" .")
    return re.sub(r"\s+", " ", name) or "Untitled"


def _resolve_inside(base: Path, rel: str) -> Path:
    path = (base / rel).resolve()
    if base.resolve() not in path.parents and path != base.resolve():
        raise NotFound(rel)
    return path


# ---------------------------------------------------------------- applications

def _defaults(kind: str) -> dict:
    import copy

    return copy.deepcopy(PROGRAM_DEFAULTS if kind == "program" else SCHOLARSHIP_DEFAULTS)


def _with_defaults(meta: dict, kind: str) -> dict:
    merged = _defaults(kind)
    merged.update({k: v for k, v in meta.items() if v is not None or k in ("decision", "response")})
    merged["kind"] = kind
    if merged.get("stage") not in STAGES:
        merged["stage"] = "researching"
    return merged


def _app_dir(app_id: str) -> Path:
    path = _resolve_inside(APPLICATIONS, app_id)
    if not (path / "README.md").is_file():
        raise NotFound(app_id)
    return path


def _load(path: Path) -> dict:
    folder = path.parent
    rel = folder.relative_to(APPLICATIONS).as_posix()
    kind = "scholarship" if rel.startswith("Scholarships/") else "program"
    meta, body = read_doc(path)
    item = _with_defaults(meta, kind)
    if not item["name"]:
        item["name"] = folder.name
    if kind == "program":
        parts = rel.split("/")
        if not item["country"] and len(parts) >= 2:
            item["country"] = parts[1]
        if not item["university"] and len(parts) >= 3:
            item["university"] = parts[2]
    item["id"] = rel
    item["body"] = body
    item["has_sop"] = (folder / "SOP.md").is_file()
    # Which statements have a draft on disk (SOP.md, SOI.md, Essay-<id>.md).
    started = [p.stem for p in folder.glob("*.md") if p.stem in ("SOP", "SOI") or (p.stem.startswith("Essay-") and not p.stem.endswith("-Coach"))]
    item["essays_started"] = sorted(s.lower() if s in ("SOP", "SOI") else s[len("Essay-"):] for s in started)
    return item


def list_applications() -> list[dict]:
    items = []
    for base in (PROGRAMS, SCHOLARSHIPS):
        if base.is_dir():
            for readme in sorted(base.rglob("README.md")):
                items.append(_load(readme))
    return items


def get_application(app_id: str) -> dict:
    return _load(_app_dir(app_id) / "README.md")


def create_application(kind: str, data: dict) -> dict:
    data = {k: v for k, v in data.items() if k not in ("id", "body", "has_sop", "essays_started")}
    if kind == "program":
        for field in ("country", "university", "name"):
            if not str(data.get(field, "")).strip():
                raise ValueError(f"'{field}' is required")
        folder = PROGRAMS / _safe_name(data["country"]) / _safe_name(data["university"]) / _safe_name(data["name"])
        checklist = PROGRAM_CHECKLIST
    else:
        if not str(data.get("name", "")).strip():
            raise ValueError("'name' is required")
        folder = SCHOLARSHIPS / _safe_name(data["name"])
        checklist = SCHOLARSHIP_CHECKLIST
    if (folder / "README.md").exists():
        raise ValueError("An entry with that name already exists")
    meta = _with_defaults(data, kind)
    if not meta["checklist"]:
        meta["checklist"] = [{"item": c, "done": False} for c in checklist]
    meta["added_on"] = date.today().isoformat()
    title = meta["name"] if kind == "scholarship" else f"{meta['name']} — {meta['university']}"
    write_doc(folder / "README.md", meta, f"# {title}\n\n## Notes\n\n")
    return _load(folder / "README.md")


def _stage_and_archive(meta: dict, patch: dict) -> None:
    """'Not considering' is a stage that archives: picking it archives the application (remembering the stage it
    was at), picking any other stage brings it back, and archive / unarchive on their own map onto the same."""
    old = meta.get("stage")
    if patch.get("stage") == DROPPED or ("stage" not in patch and patch.get("archived") is True):
        patch["stage"], patch["archived"] = DROPPED, True
        if old != DROPPED:
            patch["stage_before"] = old
    elif "stage" in patch:
        patch["archived"] = False
    elif patch.get("archived") is False and old == DROPPED:
        patch["stage"] = meta.get("stage_before") or "researching"


def update_application(app_id: str, patch: dict) -> dict:
    with WRITE_LOCK:
        folder = _app_dir(app_id)
        path = folder / "README.md"
        item = _load(path)
        meta, body = read_doc(path)
        meta = _with_defaults(meta, item["kind"])
        body = patch.pop("body", body)
        for key in ("id", "has_sop", "essays_started", "kind"):
            patch.pop(key, None)
        _stage_and_archive(meta, patch)
        meta.update(patch)
        write_doc(path, meta, body)
        return _load(path)


def delete_application(app_id: str) -> None:
    folder = _app_dir(app_id)
    shutil.rmtree(folder)
    # Prune now-empty University/Country folders under Programs.
    parent = folder.parent
    while parent not in (PROGRAMS, SCHOLARSHIPS, APPLICATIONS) and parent.is_dir() and not any(parent.iterdir()):
        parent.rmdir()
        parent = parent.parent


# ---------------------------------------------------------------- essays
# An application can need several statements. Each is listed in the README's `essays` field and kept in its own file
# beside the README: the SOP stays SOP.md / SOP-Coach.md (as before), an SOI is SOI.md / SOI-Coach.md, others Essay-<id>.md.

ESSAY_TYPES = {
    "sop": "Statement of purpose",
    "soi": "Statement of interest",
    "personal": "Personal statement",
    "research": "Research statement",
    "other": "Essay",
}


def _essay_stem(essay_id: str) -> str:
    if essay_id in ("sop", "soi"):
        return essay_id.upper()
    if not re.fullmatch(r"[a-z0-9-]{1,40}", essay_id):
        raise ValueError(f"Bad essay id {essay_id!r}")
    return f"Essay-{essay_id}"


def essays_for(item: dict) -> list[dict]:
    """The application's statements; programs that never listed any get one, typed from their essay prompt."""
    if item.get("essays"):
        return item["essays"]
    if item.get("kind") != "program":
        return []
    prompt = item.get("sop_prompt") or ""
    kind = "soi" if re.search(r"statement of interest|\bSOI\b", prompt, re.I) else "sop"
    # The default statement keeps id "sop" whatever its type, so drafts and coach notes in SOP.md / SOP-Coach.md stay attached.
    return [{"id": "sop", "type": kind, "title": ESSAY_TYPES[kind], "prompt": prompt, "limit": None}]


SUPERVISOR_EMAIL_WORDS = 200


def supervisor_email_id(name: str) -> str:
    """"John W.K. Smith" -> "email-john-w-k-smith" (fits the essay id pattern, so files are Essay-email-....md)."""
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:34].strip("-")
    return f"email-{slug or 'supervisor'}"


def supervisor_email(item: dict, essay_id: str) -> dict | None:
    """The email to one person on the program's supervisors list (`faculty`), shaped like a statement."""
    person = next((c for c in item.get("faculty") or [] if supervisor_email_id(c.get("name", "")) == essay_id), None)
    if not person:
        return None
    return {
        "id": essay_id, "type": "supervisor", "title": f"Email to {person['name']}", "person": person["name"],
        "prompt": f"A first email to {person['name']}, a potential thesis supervisor, sent after applying. "
                  f"Short: about {SUPERVISOR_EMAIL_WORDS} words plus a subject line.",
        "limit": SUPERVISOR_EMAIL_WORDS,
    }


def get_sop(app_id: str, essay_id: str = "sop") -> str:
    return read_text_if_exists(_app_dir(app_id) / f"{_essay_stem(essay_id)}.md", limit=10**7)


def save_sop(app_id: str, text: str, essay_id: str = "sop") -> None:
    path = _app_dir(app_id) / f"{_essay_stem(essay_id)}.md"
    path.write_text(text, encoding="utf-8", newline="\n")


def get_coach_notes(app_id: str, essay_id: str = "sop") -> str:
    return read_text_if_exists(_app_dir(app_id) / f"{_essay_stem(essay_id)}-Coach.md")


def add_coach_note(app_id: str, title: str, text: str, essay_id: str = "sop") -> str:
    """Newest coach feedback goes on top of the essay's -Coach.md."""
    path = _app_dir(app_id) / f"{_essay_stem(essay_id)}-Coach.md"
    previous = read_text_if_exists(path, limit=10**7)
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    entry = f"## {title} ({stamp})\n\n{text.strip()}\n"
    path.write_text(entry + ("\n---\n\n" + previous if previous else ""), encoding="utf-8", newline="\n")
    return path.read_text(encoding="utf-8")


# Versions: snapshots of a draft in Versions/<stem>/<stamp>.md beside the README (frontmatter = label, auto). One is
# taken when you ask, before a coach review, when you mark it final, and while you write (at most every AUTO_VERSION_MINUTES).
AUTO_VERSION_MINUTES = 30


def _versions_dir(app_id: str, essay_id: str) -> Path:
    return _app_dir(app_id) / "Versions" / _essay_stem(essay_id)


def _version_files(app_id: str, essay_id: str) -> list[Path]:
    """Oldest first; two snapshots in the same second are <stamp>.md then <stamp>-1.md."""
    folder = _versions_dir(app_id, essay_id)
    files = folder.glob("*.md") if folder.is_dir() else []
    return sorted(files, key=lambda p: (p.stem[:15], int(p.stem[16:] or 0)))


def _version_path(app_id: str, essay_id: str, version_id: str) -> Path:
    if not re.fullmatch(r"\d{8}-\d{6}(-\d+)?", version_id):
        raise NotFound(version_id)
    path = _versions_dir(app_id, essay_id) / f"{version_id}.md"
    if not path.is_file():
        raise NotFound(version_id)
    return path


def _version_summary(path: Path) -> dict:
    meta, text = read_doc(path)
    stamp = datetime.strptime(path.stem[:15], "%Y%m%d-%H%M%S")
    return {"id": path.stem, "label": meta.get("label") or "", "auto": bool(meta.get("auto")),
            "saved_at": stamp.isoformat(timespec="seconds"), "words": len(text.split())}


def list_essay_versions(app_id: str, essay_id: str = "sop") -> list[dict]:
    """Newest first."""
    return [_version_summary(p) for p in reversed(_version_files(app_id, essay_id))]


def get_essay_version(app_id: str, essay_id: str, version_id: str) -> dict:
    path = _version_path(app_id, essay_id, version_id)
    return {**_version_summary(path), "text": read_doc(path)[1]}


def save_essay_version(app_id: str, text: str, essay_id: str = "sop", label: str = "", auto: bool = False) -> dict | None:
    """Snapshot `text`. Returns None when it matches the newest snapshot (nothing new to keep)."""
    folder = _versions_dir(app_id, essay_id)
    newest = (_version_files(app_id, essay_id) or [None])[-1]
    if not text.strip() or (newest and read_doc(newest)[1] == text):
        return None
    folder.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    path, n = folder / f"{stamp}.md", 1
    while path.exists():
        path, n = folder / f"{stamp}-{n}.md", n + 1
    front = yaml.safe_dump({"label": label.strip()[:80], "auto": auto}, sort_keys=False, allow_unicode=True)
    path.write_text(f"---\n{front}---\n\n{text}", encoding="utf-8", newline="\n")
    return _version_summary(path)


def autosave_essay_version(app_id: str, text: str, essay_id: str = "sop") -> dict | None:
    """Called on every save: keeps a snapshot when the newest one is older than AUTO_VERSION_MINUTES."""
    newest = (_version_files(app_id, essay_id) or [None])[-1]
    if newest and (datetime.now() - datetime.strptime(newest.stem[:15], "%Y%m%d-%H%M%S")).total_seconds() < AUTO_VERSION_MINUTES * 60:
        return None
    return save_essay_version(app_id, text, essay_id, "Autosave", auto=True)


def rename_essay_version(app_id: str, essay_id: str, version_id: str, label: str) -> dict:
    path = _version_path(app_id, essay_id, version_id)
    meta, text = read_doc(path)
    front = yaml.safe_dump({**meta, "label": label.strip()[:80], "auto": False}, sort_keys=False, allow_unicode=True)
    path.write_text(f"---\n{front}---\n\n{text}", encoding="utf-8", newline="\n")
    return _version_summary(path)


def delete_essay_version(app_id: str, essay_id: str, version_id: str) -> None:
    _version_path(app_id, essay_id, version_id).unlink()


# Comments: your own notes pinned to a passage, kept in <stem>-Comments.json beside the draft. Each is
# {id, start, end, quote, text, created, resolved}; start/end are character offsets into the draft, and `quote` lets the
# editor find the passage again if the file was changed elsewhere.

def get_essay_comments(app_id: str, essay_id: str = "sop") -> list[dict]:
    path = _app_dir(app_id) / f"{_essay_stem(essay_id)}-Comments.json"
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except ValueError:
        return []
    return data if isinstance(data, list) else []


def save_essay_comments(app_id: str, comments: list[dict], essay_id: str = "sop") -> None:
    path = _app_dir(app_id) / f"{_essay_stem(essay_id)}-Comments.json"
    if not comments:
        path.unlink(missing_ok=True)
        return
    keep = ("id", "start", "end", "quote", "text", "created", "resolved")
    clean = [{k: c.get(k) for k in keep} for c in comments if isinstance(c, dict) and c.get("id")]
    path.write_text(json.dumps(clean, ensure_ascii=False, indent=1), encoding="utf-8", newline="\n")


# ---------------------------------------------------------------- faculty deep dives

# One file per person beside the README: Faculty/<Name>.md. The deep dive is rewritten on each run; everything under
# NOTES_HEADING is the applicant's own and is kept.
NOTES_HEADING = "## My notes"


def _faculty_path(app_id: str, name: str) -> Path:
    return _app_dir(app_id) / "Faculty" / f"{_safe_name(name)}.md"


def _split_notes(body: str) -> tuple[str, str]:
    head, sep, notes = body.partition(f"\n{NOTES_HEADING}\n")
    if not sep and body.startswith(f"{NOTES_HEADING}\n"):
        return "", body[len(NOTES_HEADING) + 1:].strip()
    return head.strip(), notes.strip()


def get_faculty_file(app_id: str, name: str) -> dict:
    path = _faculty_path(app_id, name)
    if not path.is_file():
        return {"exists": False, "meta": {}, "text": "", "notes": ""}
    meta, body = read_doc(path)
    text, notes = _split_notes(body)
    return {"exists": True, "meta": meta, "text": text, "notes": notes, "file": str(path.relative_to(DATA_ROOT)).replace("\\", "/")}


def save_faculty_deep_dive(app_id: str, name: str, meta: dict, text: str) -> None:
    with WRITE_LOCK:
        notes = get_faculty_file(app_id, name)["notes"]
        write_doc(_faculty_path(app_id, name), meta, f"{text.strip()}\n\n{NOTES_HEADING}\n\n{notes}")


def save_faculty_notes(app_id: str, name: str, notes: str) -> None:
    with WRITE_LOCK:
        current = get_faculty_file(app_id, name)
        meta = current["meta"] or {"name": name}
        write_doc(_faculty_path(app_id, name), meta, f"{current['text']}\n\n{NOTES_HEADING}\n\n{notes.strip()}")


# ---------------------------------------------------------------- profile

def get_profile() -> dict:
    import copy

    meta, body = read_doc(PROFILE) if PROFILE.is_file() else ({}, "")
    profile = copy.deepcopy(PROFILE_DEFAULTS)
    profile.update(meta)
    profile["shortlist_weights"] = {**PROFILE_DEFAULTS["shortlist_weights"], **(meta.get("shortlist_weights") or {})}
    profile["card_charges"] = {**PROFILE_DEFAULTS["card_charges"], **(meta.get("card_charges") or {})}
    profile["body"] = body
    profile["exists"] = PROFILE.is_file()
    return profile


def save_profile(data: dict) -> dict:
    body = data.pop("body", "")
    data.pop("exists", None)
    write_doc(PROFILE, data, body or "# Profile\n")
    return get_profile()


# ---------------------------------------------------------------- recommenders

_FIELD = re.compile(r"^- \*\*(.+?):\*\*\s*(.*)$", re.M)


def _parse_recommender(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    title = re.search(r"^# (.+)$", text, re.M)
    fields = {k.strip(): v.strip() for k, v in _FIELD.findall(text)}
    role = fields.get("Role/Title", "")
    return {
        "id": path.parent.name,
        "name": title.group(1).strip() if title else path.parent.name.replace("-", " "),
        "role": re.split(r"\s+—\s+|\*\*|\s+\(", role)[0].strip(),
        "category": fields.get("Category", ""),
        "email": re.split(r"\s+—\s+|\*\*", fields.get("Email", ""))[0].strip(),
        "body": text,
    }


def _recommender_dir(rid: str) -> Path:
    path = _resolve_inside(RECOMMENDERS, rid)
    if not (path / "Info.md").is_file():
        raise NotFound(rid)
    return path


def get_recommender(rid: str) -> dict:
    return _parse_recommender(_recommender_dir(rid) / "Info.md")


def get_letter_email(rid: str) -> dict:
    """The request email drafted for this recommender (Request-email.md: subject line, blank line, body), if any."""
    path = _recommender_dir(rid) / "Request-email.md"
    if not path.is_file():
        return {"subject": "", "body": "", "at": None}
    text = path.read_text(encoding="utf-8")
    first, _, body = text.partition("\n\n")
    return {"subject": first.removeprefix("Subject: ").strip(), "body": body.strip(),
            "at": datetime.fromtimestamp(path.stat().st_mtime).isoformat(timespec="minutes")}


def save_letter_email(rid: str, subject: str, body: str) -> dict:
    path = _recommender_dir(rid) / "Request-email.md"
    path.write_text(f"Subject: {subject.strip()}\n\n{body.strip()}\n", encoding="utf-8", newline="\n")
    return get_letter_email(rid)


RECOMMENDER_ORDER = APP_STATE / "recommender-order.json"
REMOVED_RECOMMENDERS = COMMON / "Recommenders-removed"


def list_recommenders() -> list[dict]:
    """Everyone in Common/Recommenders, in the order you set on the Letters page; anyone new goes last, by name."""
    if not RECOMMENDERS.is_dir():
        return []
    people = [_parse_recommender(p) for p in sorted(RECOMMENDERS.glob("*/Info.md"))]
    try:
        order = json.loads(RECOMMENDER_ORDER.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        order = []
    rank = {rid: i for i, rid in enumerate(order) if isinstance(rid, str)}
    return sorted(people, key=lambda p: rank.get(p["id"], len(rank)))


def save_recommender_order(ids: list[str]) -> list[dict]:
    APP_STATE.mkdir(parents=True, exist_ok=True)
    RECOMMENDER_ORDER.write_text(json.dumps([str(i) for i in ids], indent=2), encoding="utf-8")
    return list_recommenders()


def remove_recommender(rid: str) -> list[dict]:
    """Take someone off the list: their folder moves to Common/Recommenders-removed (notes kept, nothing deleted) and
    their letters come off every application."""
    folder = _recommender_dir(rid)
    REMOVED_RECOMMENDERS.mkdir(parents=True, exist_ok=True)
    target, n = REMOVED_RECOMMENDERS / folder.name, 2
    while target.exists():
        target, n = REMOVED_RECOMMENDERS / f"{folder.name}-{n}", n + 1
    shutil.move(str(folder), str(target))
    for item in list_applications():
        recs = item.get("recommenders") or []
        if any(r.get("id") == rid for r in recs):
            update_application(item["id"], {"recommenders": [r for r in recs if r.get("id") != rid]})
    return list_recommenders()


# ---------------------------------------------------------------- documents

DOC_EXTS = {".pdf", ".md", ".png", ".jpg", ".jpeg"}


def list_documents() -> list[dict]:
    """Files under Common/ worth showing on the profile page (no LaTeX sources)."""
    docs = []
    if not COMMON.is_dir():
        return docs
    for path in sorted(COMMON.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in DOC_EXTS:
            continue
        rel = path.relative_to(COMMON).as_posix()
        if rel.startswith("Recommenders/") or path == PROFILE:
            continue
        docs.append({
            "path": rel,
            "name": path.name,
            "folder": path.parent.relative_to(COMMON).as_posix(),
            "size": path.stat().st_size,
            "modified": datetime.fromtimestamp(path.stat().st_mtime).isoformat(timespec="minutes"),
        })
    return docs


def common_file(rel: str) -> Path:
    path = _resolve_inside(COMMON, rel)
    if not path.is_file():
        raise NotFound(rel)
    return path


# ---------------------------------------------------------------- courses

COURSES_MD = COMMON / "Course-Outlines" / "Courses.md"
OUTLINES = COMMON / "Course-Outlines" / "Outlines"
_COURSE_LISTS = {"learning outcomes": "outcomes", "topics and concepts": "topics", "topics": "topics", "texts": "texts"}


def _course_facts_key(label: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")


def courses() -> dict:
    """Parse Common/Course-Outlines/Courses.md: a summary table, then '## Department' and '### CODE: Title' blocks.

    Each block opens with '- **Label:** value' facts, then '**Description**' (a paragraph), list sections
    ('**Learning outcomes**', '**Topics and concepts**', '**Texts**') and one-line '**Tools:** …' fields.
    """
    if not COURSES_MD.is_file():
        return {"exists": False, "path": COURSES_MD.relative_to(COMMON).as_posix(), "intro": "", "areas": [], "courses": []}
    lines = COURSES_MD.read_text(encoding="utf-8", errors="ignore").splitlines()
    outline_files = {p.name for p in OUTLINES.iterdir()} if OUTLINES.is_dir() else set()
    intro: list[str] = []
    areas: list[dict] = []
    out: list[dict] = []
    dept = ""
    cur: dict | None = None
    section: str | None = None
    for raw in lines:
        line = raw.rstrip()
        if line.startswith("## "):
            dept, cur, section = line[3:].strip(), None, None
            continue
        if line.startswith("### "):
            code, _, title = line[4:].partition(":")
            cur = {"code": code.strip(), "title": title.strip(), "department": dept, "facts": [], "description": "",
                   "outcomes": [], "topics": [], "texts": [], "fields": [], "outline_path": None, "has_outline": False}
            out.append(cur)
            section = "facts"
            continue
        if cur is None:
            m = re.match(r"\*\*(.+?):\*\*\s*(.+)", line)
            if m and "area" in m.group(1).lower():
                for part in m.group(2).split(","):
                    name, _, num = part.strip().rpartition(" ")
                    try:
                        areas.append({"name": name, "ects": float(num)})
                    except ValueError:
                        pass
            elif not dept and line and not line.startswith(("#", "|")):
                intro.append(line)
            continue
        if not line:
            continue
        head = re.fullmatch(r"\*\*(.+?)\*\*", line)
        if head:
            section = _COURSE_LISTS.get(head.group(1).lower(), "description" if head.group(1).lower() == "description" else None)
            continue
        field = re.match(r"\*\*(.+?):\*\*\s*(.+)", line)
        if field:
            cur["fields"].append({"label": field.group(1), "value": field.group(2).strip()})
            section = None
            continue
        item = re.match(r"- (.+)", line)
        if section == "facts" and item:
            fact = re.match(r"\*\*(.+?):\*\*\s*(.*)", item.group(1))
            if fact:
                label, value = fact.group(1), fact.group(2).strip()
                cur["facts"].append({"label": label, "value": value})
                cur[_course_facts_key(label)] = value
                if label.lower() == "outline":
                    cur["has_outline"] = True
                    fname = value.split(",")[0].strip()
                    if fname in outline_files:
                        cur["outline_path"] = (OUTLINES / fname).relative_to(COMMON).as_posix()
            continue
        if section in ("outcomes", "topics", "texts") and item:
            cur[section].append(item.group(1).strip())
        elif section == "description":
            cur["description"] = (cur["description"] + " " + line.strip()).strip()
        elif line.startswith("_") and line.endswith("_"):
            cur["note"] = cur.get("note") or line.strip("_")
    return {"exists": True, "path": COURSES_MD.relative_to(COMMON).as_posix(), "intro": " ".join(intro).strip(),
            "areas": areas, "courses": out, "modified": datetime.fromtimestamp(COURSES_MD.stat().st_mtime).date().isoformat()}


def read_text_if_exists(path: Path, limit: int = 60_000) -> str:
    return path.read_text(encoding="utf-8", errors="ignore")[:limit] if path.is_file() else ""


def resume_text() -> str:
    """Concatenated LaTeX sections of the master resume, for AI context."""
    for folder in ("master-resume", "resume"):
        files = sorted((COMMON / "Resume" / folder / "content-files").glob("*.tex"))
        if files:
            return "\n\n".join(f.read_text(encoding="utf-8", errors="ignore") for f in files)
    return ""


# ---------------------------------------------------------------- test score reports

# Score reports also carry name, address, birth date and ID numbers, often on lines of their own. Keep only lines that
# are about results (test and section names, score words, short numbers); everything else stays on this machine.
_RESULT_LINE = re.compile(
    r"(toefl|ielts|gre\b|gmat|duolingo|pte|sat\b|act\b|ibt|test date|score|total|overall|band|reading|listening|speaking|writing|"
    r"verbal|quantitative|quant\b|analytical|integrated|literacy|comprehension|conversation|production|percentile|cefr|"
    r"valid|expir|section|level|out of|mybest|scale|range)",
    re.I,
)
_SCORE_ONLY = re.compile(r"^[\d.]{1,4}(\s*/\s*\d{1,3})?$")
_PRIVATE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+|\b\d{4}[\s-]\d{4}[\s-]\d{4}\b|date of birth|birth", re.I)


def test_reports() -> list[dict]:
    """Text of each PDF in Common/Test-Scores, with personal details removed."""
    folder = COMMON / "Test-Scores"
    if not folder.is_dir():
        return []
    try:
        import pypdf
    except ImportError:
        return []
    out = []
    for pdf in sorted(folder.glob("*.pdf")):
        try:
            reader = pypdf.PdfReader(str(pdf))
            text = "\n".join(page.extract_text() or "" for page in reader.pages)
        except Exception:  # unreadable or scanned PDFs are skipped, not fatal
            continue
        lines = [
            ln.strip() for ln in text.splitlines()
            if ln.strip() and not _PRIVATE.search(ln) and (_RESULT_LINE.search(ln) or _SCORE_ONLY.match(ln.strip()))
        ]
        out.append({"file": f"Test-Scores/{pdf.name}", "text": "\n".join(lines)[:8000]})
    return out


# ---------------------------------------------------------------- first-run setup

DATA_GITIGNORE = """\
# Passwords and anything else that should never leave this computer
Private/

# The app's own history (usage, agent logs, searches)
.app/
"""

DATA_README = """\
# My application data

Everything the Masters app knows about you lives here: your profile, resumes,
transcript, test scores, recommenders and every application. The app's code
lives one folder up and its git repo ignores this folder, so sharing the app
never shares this.

To back this folder up, make it its own private git repo (the setup screen can
do the `git init` for you) and push it to a private remote. `Private/` and
`.app/` are ignored by it.
"""


def _git(*args: str) -> subprocess.CompletedProcess | None:
    try:
        return subprocess.run(["git", *args], capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        return None


def _exposed_to_app_repo() -> bool | None:
    """True when the data root sits inside the app's git repo without being ignored, so a commit could share it.
    None when that can't be checked (git missing, or the app isn't a git checkout)."""
    if DATA_ROOT != REPO_ROOT and REPO_ROOT not in DATA_ROOT.parents:
        return False
    if not (REPO_ROOT / ".git").exists():
        return None
    result = _git("-C", str(REPO_ROOT), "check-ignore", "-q", str(DATA_ROOT / "Common" / "Profile.md"))
    if result is None or result.returncode > 1:
        return None
    return result.returncode == 1


def setup_status() -> dict:
    return {
        "data_root": str(DATA_ROOT),
        "ready": COMMON.is_dir() and APPLICATIONS.is_dir(),
        "git": (DATA_ROOT / ".git").exists(),
        "exposed": _exposed_to_app_repo(),
        "sample_available": SAMPLE_DATA.is_dir(),
    }


def init_data_root(example: bool = False, git: bool = False) -> dict:
    """Create the data folder (or fill in what's missing). Never overwrites a file that's already there."""
    if _exposed_to_app_repo():
        raise ValueError(f"{DATA_ROOT} is inside the app's git repo and not ignored, so your data could be committed and shared. "
                         "Use the default data/ folder or set DATA_ROOT in app/.env to a folder outside the repo.")
    for folder in (COMMON / "Recommenders", COMMON / "Resume", COMMON / "Test-Scores", COMMON / "Transcript", PROGRAMS, SCHOLARSHIPS):
        folder.mkdir(parents=True, exist_ok=True)
    for path, text in ((DATA_ROOT / ".gitignore", DATA_GITIGNORE), (DATA_ROOT / "README.md", DATA_README)):
        if not path.exists():
            path.write_text(text, encoding="utf-8", newline="\n")
    if example and SAMPLE_DATA.is_dir():
        for src in SAMPLE_DATA.rglob("*"):
            dest = DATA_ROOT / src.relative_to(SAMPLE_DATA)
            if src.is_file() and not dest.exists():
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dest)
    if git and not (DATA_ROOT / ".git").exists():
        result = _git("init", "-q", str(DATA_ROOT))
        if result is None or result.returncode:
            raise ValueError("Your data folder was created, but git init failed. Is git installed?")
    return setup_status()
