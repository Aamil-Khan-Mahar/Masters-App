"""FastAPI server: JSON API over the file store, plus the built React UI."""

from __future__ import annotations

import json
import os
import re
import unicodedata
import uuid
from datetime import date, datetime
from pathlib import Path
from typing import Any, Callable

from dotenv import load_dotenv

APP_DIR = Path(__file__).resolve().parents[1]
load_dotenv(APP_DIR / ".env")

from fastapi import Body, FastAPI, HTTPException  # noqa: E402
from fastapi.responses import FileResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402

import agents  # noqa: E402
import ai  # noqa: E402
import requirements  # noqa: E402
import resume  # noqa: E402
import essay_pdf  # noqa: E402
import final  # noqa: E402
import store  # noqa: E402
from pypdf import PdfReader  # noqa: E402

app = FastAPI(title="Masters App")
# The app's history is about its user, so it lives with their data, not with the code.
LOCAL = store.APP_STATE
USAGE_LOG = LOCAL / "usage.jsonl"
DISCOVERY = LOCAL / "discovery.json"
FX_CACHE = LOCAL / "fx.json"


def _not_found(fn: Callable, *args):
    try:
        return fn(*args)
    except store.NotFound:
        raise HTTPException(404, "Not found")
    except ValueError as e:
        raise HTTPException(400, str(e))


# ---------------------------------------------------------------- agents
# Every AI task runs as an agent (see agents.py): up to AGENTS_MAX at once, the rest wait their turn.


def _log_usage(kind: str, label: str, usage: dict) -> None:
    LOCAL.mkdir(parents=True, exist_ok=True)
    with USAGE_LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps({"at": datetime.now().isoformat(timespec="seconds"), "kind": kind, "label": label, **usage}) + "\n")


DISPATCH = agents.Dispatcher(LOCAL / "agents.jsonl", _log_usage)


def _start_job(kind: str, label: str, work: Callable[[], tuple[Any, dict]], on_done: Callable[[Any], Any] | None = None,
               params: dict | None = None, mission: dict | None = None, depends_on: list[str] | None = None,
               strong: bool = False) -> dict:
    """`strong` runs this agent on the stronger model (Opus) instead of the default."""
    if not ai.configured():
        raise HTTPException(400, "No way to reach Claude: install and log in to Claude Code, or add ANTHROPIC_API_KEY to app/.env, then restart.")
    def locked(result: Any) -> Any:
        with store.WRITE_LOCK:
            return on_done(result)

    model = ai.MODEL_STRONG if strong else None
    return DISPATCH.start(kind, label, work, locked if on_done else None, params, mission, depends_on, model)


@app.get("/api/jobs")
def list_jobs():
    return DISPATCH.list()


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    job = DISPATCH.get(job_id)
    if not job:
        raise HTTPException(404, "Unknown job")
    return job


@app.post("/api/jobs/{job_id}/cancel")
def cancel_job(job_id: str):
    job = DISPATCH.cancel(job_id)
    if not job:
        raise HTTPException(404, "Unknown job")
    return job


@app.get("/api/agents/meta")
def agents_meta():
    return {"max_active": agents.MAX_ACTIVE, "roles": agents.ROLES}


# ---------------------------------------------------------------- meta

@app.get("/api/meta")
def meta():
    spend = 0.0
    if USAGE_LOG.is_file():
        for line in USAGE_LOG.read_text(encoding="utf-8").splitlines():
            try:
                spend += json.loads(line).get("cost_usd", 0)
            except json.JSONDecodeError:
                pass
    return {
        "data_root": str(store.DATA_ROOT),
        "setup": store.setup_status(),
        "ai_configured": ai.configured(),
        "ai_backend": ai.backend(),
        "model": ai.MODEL,
        "model_strong": ai.MODEL_STRONG,
        "ai_spend_usd": round(spend, 4),
        "stages": store.STAGES,
        "decisions": store.DECISIONS,
        "responses": store.RESPONSES,
        "rec_statuses": store.REC_STATUSES,
        "today": date.today().isoformat(),
    }


@app.get("/api/setup")
def setup_status():
    return store.setup_status()


@app.post("/api/setup")
def setup(data: dict = Body(...)):
    """First run: create the data folder, optionally with example data and as its own git repo."""
    return _not_found(store.init_data_root, bool(data.get("example")), bool(data.get("git")))


# ---------------------------------------------------------------- applications

@app.get("/api/applications")
def list_applications():
    return store.list_applications()


@app.post("/api/applications")
def create_application(data: dict = Body(...)):
    kind = data.pop("kind", "program")
    if kind not in ("program", "scholarship"):
        raise HTTPException(400, "kind must be program or scholarship")
    return _not_found(store.create_application, kind, data)


# Each starter reads the application fresh when it applies results, because teammates
# write to the same README while they work.

def _start_research(app_id: str, **team) -> dict:
    item = _not_found(store.get_application, app_id)

    def apply(result: dict) -> dict:
        current = store.get_application(app_id)
        summary = result.pop("summary", "")
        patch = {k: v for k, v in result.items() if v not in (None, "", [])}
        if current["kind"] == "program" and result.get("application_fee") is not None:
            fee = {"label": "Application fee", "amount": result["application_fee"], "currency": result.get("application_fee_currency", ""), "paid": False, "date": None}
            others = [e for e in current["expenses"] if e.get("label") != "Application fee"]
            existing = next((e for e in current["expenses"] if e.get("label") == "Application fee"), None)
            patch["expenses"] = [existing or fee] + others
        # Essays found by research only fill an empty list: ids you've drafted under are never replaced.
        if current.get("essays") or not _ask_value("essays", json.dumps(result.get("essays") or []))[1]:
            patch.pop("essays", None)
        patch.pop("application_fee", None)
        patch.pop("application_fee_currency", None)
        patch["sources"] = list(dict.fromkeys([*current.get("sources", []), *result.get("sources", [])]))
        patch["researched_on"] = date.today().isoformat()
        patch["body"] = _replace_section(current["body"], "Research", summary)
        return store.update_application(app_id, patch)

    return _start_job("research", item["name"], lambda: ai.research(item), apply, {"app_id": app_id}, **team)


def _start_score(app_id: str, **team) -> dict:
    item = _not_found(store.get_application, app_id)
    # Read the application when the work starts, so a mission's Assessor sees its teammates' findings.
    return _start_job("score", item["name"], lambda: ai.score(store.get_application(app_id)),
                      lambda r: store.update_application(app_id, {"scores": r}), {"app_id": app_id}, **team)


def _start_course_check(app_id: str, **team) -> dict:
    item = _not_found(store.get_application, app_id)
    courses = store.courses()
    if not courses["courses"]:
        raise HTTPException(400, f"Add your courses first: {courses['path']} under Common/ (see You, Courses).")

    def apply(result: dict) -> dict:
        current = store.get_application(app_id)
        sources = list(dict.fromkeys([*current.get("sources", []), *result.get("sources", [])]))
        return store.update_application(app_id, {"course_check": result, "sources": sources})

    return _start_job("course-check", item["name"], lambda: ai.course_check(store.get_application(app_id), courses),
                      apply, {"app_id": app_id}, **team)


def _course_check_stale(item: dict) -> bool:
    """No check yet, older than FRESH_DAYS, or Courses.md changed since."""
    day = (item.get("course_check") or {}).get("checked_on")
    if not _fresh(day):
        return True
    modified = store.courses().get("modified")
    return bool(modified and modified > day)


def _person_key(name: str) -> str:
    """'Jane R. Doe' and 'Jane Doe', 'John W.K. Smith' and 'John WK Smith' are the same person."""
    words = re.sub(r"[^\w\s]", "", unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()).lower().split()
    return f"{words[0]} {words[-1]}" if words else ""


def _start_faculty(app_id: str, url: str, extra: bool = False, **team) -> dict:
    """Copy a faculty page into the list. The program's supervisors page sets who is `listed`; an extra page
    (department contacts, a lab list) only adds people not already there, marked `listed: false`."""
    item = _not_found(store.get_application, app_id)

    def apply(result: dict) -> dict:
        current = store.get_application(app_id)
        existing = current.get("faculty_profiles") or []
        if extra:
            have = {_person_key(f["name"]) for f in existing}
            added = [{**p, "listed": False, "source": url} for p in result["faculty"] if _person_key(p["name"]) not in have]
            return store.update_application(app_id, {
                "faculty_profiles": existing + added,
                "faculty_extra_urls": list(dict.fromkeys([*(current.get("faculty_extra_urls") or []), url])),
            })
        # The list mirrors the directory page; people already researched keep their research,
        # and people added from extra pages stay (they become listed if the page now names them).
        known = {_person_key(f["name"]): f for f in existing if f.get("researched_on")}
        people = [{k: v for k, v in known.get(_person_key(p["name"]), p).items() if k not in ("listed", "source")} for p in result["faculty"]]
        on_page = {_person_key(p["name"]) for p in people}
        people += [f for f in existing if f.get("listed") is False and _person_key(f["name"]) not in on_page]
        return store.update_application(app_id, {
            "faculty_profiles": people,
            "faculty_source_url": url,
            "faculty_researched_on": date.today().isoformat(),
        })

    label = f"{item['name']} (extra page)" if extra else item["name"]
    return _start_job("faculty", label, lambda: ai.faculty_list(item, url, extra), apply, {"app_id": app_id, "url": url, "extra": extra}, **team)


def _start_faculty_member(app_id: str, name: str, strong: bool = False) -> dict:
    item = _not_found(store.get_application, app_id)
    person = next((f for f in item.get("faculty_profiles") or [] if f["name"].lower() == name.lower()), None)
    if not person:
        raise HTTPException(404, f"{name} isn't in this program's faculty list")

    def apply(result: dict) -> dict:
        current = store.get_application(app_id)
        people = [
            {**f, **{k: v for k, v in result.items() if v not in (None, "")}, "researched_on": date.today().isoformat()}
            if f["name"].lower() == name.lower() else f
            for f in current.get("faculty_profiles") or []
        ]
        return store.update_application(app_id, {"faculty_profiles": people})

    return _start_job("faculty-member", f"{person['name']}, {item['university'] or item['name']}",
                      lambda: ai.faculty_member(item, person), apply, {"app_id": app_id, "name": person["name"]}, strong=strong)


def _member_busy(app_id: str, name: str) -> bool:
    return any(j["kind"] == "faculty-member" and j["status"] not in agents.FINAL
               and j["params"].get("app_id") == app_id and j["params"].get("name", "").lower() == name.lower()
               for j in DISPATCH.jobs.values())


def _start_funding(app_id: str, **team) -> dict:
    item = _not_found(store.get_application, app_id)

    def apply(result: dict) -> dict:
        current = store.get_application(app_id)
        sources = list(dict.fromkeys([*current.get("sources", []), *result.pop("sources", [])]))
        return store.update_application(app_id, {
            "funding_details": result,
            "funding_researched_on": date.today().isoformat(),
            "sources": sources,
        })

    return _start_job("funding", item["name"], lambda: ai.funding(item), apply, {"app_id": app_id}, **team)


@app.post("/api/applications/{app_id:path}/research")
def research_application(app_id: str, data: dict = Body(default={})):
    return _start_research(app_id, strong=bool(data.get("strong")))


@app.post("/api/applications/{app_id:path}/score")
def score_application(app_id: str, data: dict = Body(default={})):
    return _start_score(app_id, strong=bool(data.get("strong")))


@app.post("/api/applications/{app_id:path}/course-check")
def check_courses(app_id: str, data: dict = Body(default={})):
    return _start_course_check(app_id, strong=bool(data.get("strong")))


# ---------------------------------------------------------------- entry-requirements checklist (requirements.py)

def _last_requirements_job() -> str | None:
    """The newest checklist build still waiting or working, so the next one queues behind it."""
    active = [j for j in DISPATCH.jobs.values() if j["kind"] == "requirements" and j["status"] in ("waiting", "working")]
    return active[-1]["id"] if active else None


def _start_requirements(app_id: str, **team) -> dict:
    """Checklist builds always run one at a time: each reads whole statutes, and parallel runs burn the usage limit."""
    item = _not_found(store.get_application, app_id)
    if item["kind"] != "program":
        raise HTTPException(400, "The entry-requirements checklist is for programs.")
    if not team.get("depends_on"):
        prev = _last_requirements_job()
        team["depends_on"] = [prev] if prev else None
    return _start_job("requirements", item["name"], lambda: requirements.build(app_id),
                      lambda built: requirements.commit(app_id, built), {"app_id": app_id}, **team)


@app.post("/api/applications/{app_id:path}/requirements")
def build_requirements(app_id: str, data: dict = Body(default={})):
    return _start_requirements(app_id, strong=bool(data.get("strong")))


@app.get("/api/applications/{app_id:path}/requirements/sources/{n}")
def requirement_source(app_id: str, n: int):
    return {"text": _not_found(requirements.source_text, app_id, n)}


@app.put("/api/applications/{app_id:path}/requirements/items/{key}")
def mark_requirement(app_id: str, key: str, data: dict = Body(...)):
    meta = _not_found(requirements.set_mine, app_id, key, data)
    store.update_application(app_id, {"requirements_check": requirements.summary(meta)})
    return meta


@app.get("/api/applications/{app_id:path}/requirements")
def get_requirements(app_id: str):
    _not_found(store.get_application, app_id)
    return requirements.load(app_id)


@app.post("/api/requirements/build")
def build_many_requirements(data: dict = Body(...)):
    """Checklists for several programs ({ids, strong}), strictly one after another: each is a long read of whole
    statutes, so running them in parallel burns through the Claude usage limit."""
    ids = data.get("ids") or []
    for i in ids:  # check them all first, so a bad id never leaves half a batch queued
        if _not_found(store.get_application, i)["kind"] != "program":
            raise HTTPException(400, f"Not a program: {i}")
    agents = []
    for i in ids:  # each queues behind the previous one (see _start_requirements)
        agents.append(_start_requirements(i, strong=bool(data.get("strong"))))
    return {"agents": agents}


@app.get("/api/requirements")
def all_requirements():
    """Every program's checklist in brief, for the cross-program page."""
    out = []
    for item in store.list_applications():
        if item["kind"] != "program" or item.get("archived"):
            continue
        meta = requirements.load(item["id"])
        mine = meta.get("mine") or {}
        open_items = []
        for it in meta.get("items") or []:
            m = mine.get(it["key"]) or {}
            status = m.get("status") or it.get("status")
            if not m.get("done") and status not in ("met", "not applicable"):
                open_items.append({"key": it["key"], "title": it.get("title"), "group": it.get("group"), "status": status, "kind": it.get("kind")})
        out.append({"id": item["id"], "name": item["name"], "university": item.get("university"), "country": item.get("country"),
                    "stage": item.get("stage"), "summary": requirements.summary(meta) if meta else None, "open": open_items})
    return out


@app.post("/api/applications/{app_id:path}/faculty")
def fetch_faculty(app_id: str, data: dict = Body(default={})):
    item = _not_found(store.get_application, app_id)
    extra = bool(data.get("extra"))
    url = (data.get("url") or ("" if extra else item.get("faculty_source_url")) or "").strip()
    if not url.startswith("http"):
        raise HTTPException(400, "Paste the page's link" if extra else "Add the program's faculty or supervisor directory link first")
    return _start_faculty(app_id, url, extra=extra, strong=bool(data.get("strong")))


@app.post("/api/applications/{app_id:path}/faculty-member")
def research_faculty_member(app_id: str, data: dict = Body(default={})):
    name = (data.get("name") or "").strip()
    if _member_busy(app_id, name):
        raise HTTPException(409, f"{name} is already being researched")
    return _start_faculty_member(app_id, name, strong=bool(data.get("strong")))


def _person(item: dict, name: str) -> dict:
    person = next((f for f in item.get("faculty_profiles") or [] if f["name"].lower() == (name or "").lower()), None)
    if not person:
        raise HTTPException(404, f"{name} isn't in this program's faculty list")
    return person


@app.post("/api/applications/{app_id:path}/faculty-member/deep-dive")
def faculty_deep_dive(app_id: str, data: dict = Body(...)):
    """In-depth profile of one person, written to <program>/Faculty/<Name>.md (your notes there are kept).
    Also refreshes their card: match, research summary, why, accepting."""
    item = _not_found(store.get_application, app_id)
    person = _person(item, data.get("name", ""))
    name = person["name"]

    def apply(result: dict) -> dict:
        today = date.today().isoformat()
        profile, sources = result.pop("profile", ""), result.pop("sources", [])
        card = {k: v for k, v in result.items() if v not in (None, "")}
        store.save_faculty_deep_dive(app_id, name, {
            "name": name, "title": card.get("title", person.get("title", "")), "department": card.get("department", person.get("department", "")),
            "url": card.get("url", person.get("url", "")), "match": card.get("match"), "accepting": card.get("accepting"),
            "researched_on": today, "sources": sources,
        }, f"# {name}\n\n{profile}")
        current = store.get_application(app_id)
        people = [{**f, **card, "researched_on": today, "deep_dive_on": today} if f["name"].lower() == name.lower() else f
                  for f in current.get("faculty_profiles") or []]
        return store.update_application(app_id, {"faculty_profiles": people})

    return _start_job("faculty-deep", f"{name}, {item['university'] or item['name']}",
                      lambda: ai.faculty_deep_dive(store.get_application(app_id), person), apply,
                      {"app_id": app_id, "name": name}, strong=bool(data.get("strong")))


@app.get("/api/applications/{app_id:path}/faculty-member/profile")
def faculty_profile(app_id: str, name: str):
    item = _not_found(store.get_application, app_id)
    return store.get_faculty_file(app_id, _person(item, name)["name"])


@app.put("/api/applications/{app_id:path}/faculty-member/notes")
def faculty_notes(app_id: str, data: dict = Body(...)):
    item = _not_found(store.get_application, app_id)
    store.save_faculty_notes(app_id, _person(item, data.get("name", ""))["name"], data.get("notes", ""))
    return {"ok": True}


@app.post("/api/applications/{app_id:path}/faculty-members")
def research_all_faculty(app_id: str, data: dict = Body(default={})):
    """One agent per person not researched yet (all of them with `force`). They queue behind AGENTS_MAX."""
    item = _not_found(store.get_application, app_id)
    if not ai.configured():
        raise HTTPException(400, "No way to reach Claude: install and log in to Claude Code, or add ANTHROPIC_API_KEY to app/.env, then restart.")
    force, strong = bool(data.get("force")), bool(data.get("strong"))
    names = [f["name"] for f in item.get("faculty_profiles") or []
             if (force or not f.get("researched_on")) and not _member_busy(app_id, f["name"])]
    return {"agents": [_start_faculty_member(app_id, n, strong) for n in names]}


@app.post("/api/applications/{app_id:path}/funding")
def research_funding(app_id: str, data: dict = Body(default={})):
    return _start_funding(app_id, strong=bool(data.get("strong")))


# Shape checks for an ask's changes: the model returns JSON text, so make sure it is the right kind before saving.
_ASK_LISTS = {"deadlines", "requirements", "checklist", "expenses", "courses", "eligibility", "selection", "essays", "faculty_extra_urls"}
_ASK_OBJECTS = {"admission", "portal"}
_ASK_NUMBERS = {"tuition_usd_per_year", "living_usd_per_year"}


def _ask_value(field: str, raw: str):
    try:
        v = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None, False
    if field in _ASK_LISTS:
        ok = isinstance(v, list)
        if ok and field == "deadlines":
            ok = all(isinstance(d, dict) and d.get("label") and isinstance(d.get("date"), str) for d in v)
        if ok and field == "essays":
            ok = bool(v) and all(
                isinstance(e, dict) and re.fullmatch(r"[a-z0-9-]{1,40}", str(e.get("id", ""))) and e.get("type") in store.ESSAY_TYPES
                and isinstance(e.get("title"), str) and isinstance(e.get("prompt", ""), str)
                and (e.get("limit") is None or isinstance(e.get("limit"), (int, float)))
                for e in v
            ) and len({e["id"] for e in v}) == len(v)
    elif field in _ASK_OBJECTS:
        ok = isinstance(v, dict)
    elif field in _ASK_NUMBERS:
        ok = v is None or isinstance(v, (int, float))
    else:
        ok = isinstance(v, str)
    return v, ok


@app.post("/api/applications/{app_id:path}/ask")
def ask_application(app_id: str, data: dict = Body(default={})):
    """One targeted request ("add the IELTS minimum", "is the GRE required?"): researched on its own,
    changing only the fields it needs. Every ask is kept on the application, newest first."""
    _not_found(store.get_application, app_id)
    request = (data.get("question") or "").strip()
    if not request:
        raise HTTPException(400, "Write what you want Claude to find or add")

    def apply(result: dict) -> dict:
        current = store.get_application(app_id)
        patch: dict = {}
        changed: list[str] = []
        for c in result.get("changes") or []:
            field = c.get("field")
            if field not in ai.ASK_FIELDS:
                continue
            value, ok = _ask_value(field, c.get("value_json"))
            if ok and field == "faculty_extra_urls":
                # New pages go to the faculty agent, which records the page once its people are in the list.
                known = {*(current.get("faculty_extra_urls") or []), current.get("faculty_source_url")}
                for url in [u.strip() for u in value if isinstance(u, str) and u.strip().startswith("http") and u.strip() not in known]:
                    _start_faculty(app_id, url, extra=True)
                    changed.append(f"faculty (adding people from {url})")
                continue
            if ok:
                patch[field] = value
                changed.append(field)
        entry = {
            "at": datetime.now().isoformat(timespec="minutes"),
            "question": request,
            "answer": result.get("answer", ""),
            "changed": changed,
            "sources": result.get("sources") or [],
        }
        patch["asks"] = [entry, *(current.get("asks") or [])][:20]
        patch["sources"] = list(dict.fromkeys([*current.get("sources", []), *(result.get("sources") or [])]))
        return store.update_application(app_id, patch)

    # Read the application when the agent starts, so a queued ask sees the latest data.
    return _start_job("ask", request[:70], lambda: ai.ask(store.get_application(app_id), request), apply,
                      {"app_id": app_id, "question": request}, strong=bool(data.get("strong")))


@app.post("/api/tests/ask")
def ask_tests(data: dict = Body(default={})):
    """Update the test list from a plain note ("booked IELTS for 12 Dec") and/or the PDFs in Common/Test-Scores."""
    note = (data.get("note") or "").strip()
    read_reports = bool(data.get("read_reports"))
    if not note and not read_reports:
        raise HTTPException(400, "Write what to add, or ask Claude to read your score reports")

    def work():
        reports = store.test_reports() if read_reports else []
        return ai.tests_update(note, store.get_profile().get("tests") or [], reports)

    def apply(result: dict) -> dict:
        profile = store.get_profile()
        tests = sorted(result.get("tests") or [], key=lambda t: t.get("date") or "", reverse=True)
        log = [{"at": datetime.now().isoformat(timespec="minutes"), "note": note or "Read my score reports", "answer": result.get("answer", "")}]
        profile["tests"] = tests
        profile["tests_log"] = (log + (profile.get("tests_log") or []))[:10]
        return store.save_profile(profile)

    label = note[:60] if note else "Read score reports"
    return _start_job("tests", label, work, apply, {"note": note}, strong=bool(data.get("strong")))


FRESH_DAYS = 30


def _fresh(day: str | None) -> bool:
    return bool(day) and (date.today() - date.fromisoformat(day)).days < FRESH_DAYS


@app.post("/api/applications/{app_id:path}/mission")
def start_mission(app_id: str, data: dict = Body(default={})):
    """A research team: Researcher, Accountant and Recruiter work in parallel, then the Assessor scores.
    Parts researched in the last FRESH_DAYS are skipped unless `force` is set, to save usage."""
    item = _not_found(store.get_application, app_id)
    if not ai.configured():
        raise HTTPException(400, "No way to reach Claude: install and log in to Claude Code, or add ANTHROPIC_API_KEY to app/.env, then restart.")
    force = bool(data.get("force"))
    strong = bool(data.get("strong"))
    name = item["university"] if item["kind"] == "program" else item["name"]
    mission = {"id": uuid.uuid4().hex[:10], "label": f"Full research: {name}", "app_id": app_id}
    team, skipped = [], []
    if force or not _fresh(item.get("researched_on")):
        team.append(_start_research(app_id, mission=mission, strong=strong))
    else:
        skipped.append("profile")
    if item["kind"] == "program":
        if force or not _fresh(item.get("funding_researched_on")):
            team.append(_start_funding(app_id, mission=mission, strong=strong))
        else:
            skipped.append("funding")
        url = (item.get("faculty_source_url") or "").strip()
        if url.startswith("http") and (force or not _fresh(item.get("faculty_researched_on"))):
            team.append(_start_faculty(app_id, url, mission=mission, strong=strong))
        elif url.startswith("http"):
            skipped.append("faculty")
        # Always compare your courses with the official requirements (when Courses.md exists).
        if store.courses()["courses"]:
            if force or _course_check_stale(item):
                team.append(_start_course_check(app_id, mission=mission, strong=strong))
            else:
                skipped.append("courses")
        # Only rescore when something new was found (or nothing was ever scored).
        if team or not (item.get("scores") or {}).get("scored_on"):
            team.append(_start_score(app_id, mission=mission, depends_on=[j["id"] for j in team], strong=strong))
    return {"mission": mission, "agents": team, "skipped": skipped}


def _essay(item: dict, essay_id: str) -> dict:
    if essay_id.startswith("email-"):
        # A first email to a supervisor you're tracking: not one of the application's statements (never a to-do or in
        # the Final folder), but written and coached with the same editor, versions, comments, pointers and review.
        essay = store.supervisor_email(item, essay_id)
        if not essay:
            raise HTTPException(404, "That person isn't on your supervisors list for this program")
        return essay
    essay = next((e for e in store.essays_for(item) if e["id"] == essay_id), None)
    if not essay:
        raise HTTPException(404, f"No statement {essay_id!r} on this application")
    return essay


@app.get("/api/applications/{app_id:path}/essays/{essay_id}")
def get_essay(app_id: str, essay_id: str):
    item = _not_found(store.get_application, app_id)
    _essay(item, essay_id)
    return {"text": store.get_sop(app_id, essay_id), "coach": store.get_coach_notes(app_id, essay_id),
            "comments": store.get_essay_comments(app_id, essay_id)}


@app.put("/api/applications/{app_id:path}/essays/{essay_id}")
def put_essay(app_id: str, essay_id: str, data: dict = Body(...)):
    item = _not_found(store.get_application, app_id)
    _essay(item, essay_id)
    text = data.get("text", "")
    store.save_sop(app_id, text, essay_id)
    if "comments" in data:
        store.save_essay_comments(app_id, data["comments"] or [], essay_id)
    return {"ok": True, "version": store.autosave_essay_version(app_id, text, essay_id)}


@app.get("/api/applications/{app_id:path}/essays/{essay_id}/versions")
def essay_versions(app_id: str, essay_id: str):
    _essay(_not_found(store.get_application, app_id), essay_id)
    return store.list_essay_versions(app_id, essay_id)


@app.post("/api/applications/{app_id:path}/essays/{essay_id}/versions")
def essay_save_version(app_id: str, essay_id: str, data: dict = Body(default={})):
    """Snapshot the saved draft (or `text`, when given) under an optional `label`."""
    _essay(_not_found(store.get_application, app_id), essay_id)
    text = data["text"] if isinstance(data.get("text"), str) else store.get_sop(app_id, essay_id)
    version = store.save_essay_version(app_id, text, essay_id, str(data.get("label") or ""))
    if not version and data.get("label"):
        # Same text as the newest snapshot: name that one instead of keeping a duplicate.
        newest = store.list_essay_versions(app_id, essay_id)[0]
        version = store.rename_essay_version(app_id, essay_id, newest["id"], str(data["label"]))
    return {"version": version}


@app.get("/api/applications/{app_id:path}/essays/{essay_id}/versions/{version_id}")
def essay_version(app_id: str, essay_id: str, version_id: str):
    _essay(_not_found(store.get_application, app_id), essay_id)
    return _not_found(store.get_essay_version, app_id, essay_id, version_id)


@app.patch("/api/applications/{app_id:path}/essays/{essay_id}/versions/{version_id}")
def essay_rename_version(app_id: str, essay_id: str, version_id: str, data: dict = Body(...)):
    _essay(_not_found(store.get_application, app_id), essay_id)
    return _not_found(store.rename_essay_version, app_id, essay_id, version_id, str(data.get("label") or ""))


@app.delete("/api/applications/{app_id:path}/essays/{essay_id}/versions/{version_id}")
def essay_delete_version(app_id: str, essay_id: str, version_id: str):
    _essay(_not_found(store.get_application, app_id), essay_id)
    _not_found(store.delete_essay_version, app_id, essay_id, version_id)
    return {"ok": True}


@app.post("/api/applications/{app_id:path}/essays/{essay_id}/versions/{version_id}/restore")
def essay_restore_version(app_id: str, essay_id: str, version_id: str):
    """Bring an old version back as the draft; the current draft is kept as a version first, so nothing is lost."""
    _essay(_not_found(store.get_application, app_id), essay_id)
    old = _not_found(store.get_essay_version, app_id, essay_id, version_id)
    store.save_essay_version(app_id, store.get_sop(app_id, essay_id), essay_id, "Before restoring", auto=True)
    store.save_sop(app_id, old["text"], essay_id)
    return {"text": old["text"]}


@app.post("/api/applications/{app_id:path}/essays/{essay_id}/outline")
def essay_outline(app_id: str, essay_id: str, data: dict = Body(default={})):
    item = _not_found(store.get_application, app_id)
    essay = _essay(item, essay_id)
    return _start_job("sop-outline", f"{essay['title']}: {item['name']}",
                      lambda: ai.sop_outline(store.get_application(app_id), essay),
                      lambda r: store.add_coach_note(app_id, "Structure & pointers", r, essay_id),
                      {"app_id": app_id, "essay": essay_id}, strong=bool(data.get("strong")))


@app.post("/api/applications/{app_id:path}/essays/{essay_id}/review")
def essay_review(app_id: str, essay_id: str, data: dict = Body(...)):
    item = _not_found(store.get_application, app_id)
    essay = _essay(item, essay_id)
    draft = data.get("text", "")
    store.save_essay_version(app_id, draft, essay_id, "Sent for review", auto=True)
    return _start_job("sop-review", f"{essay['title']}: {item['name']}",
                      lambda: ai.sop_review(store.get_application(app_id), draft, essay, store.get_essay_comments(app_id, essay_id)),
                      lambda r: store.add_coach_note(app_id, "Draft review", r, essay_id),
                      {"app_id": app_id, "essay": essay_id}, strong=bool(data.get("strong")))


@app.post("/api/applications/{app_id:path}/resume")
def build_resume(app_id: str, data: dict = Body(default={})):
    """Copy the master resume beside this application and cut it to `max_pages` (default 3) by removing and
    reordering whole entries. Claude picks the entries; resume.build re-assembles the text verbatim and compiles it."""
    item = _not_found(store.get_application, app_id)
    if not resume.tectonic():
        raise HTTPException(400, "Tectonic isn't installed, so the resume can't be compiled.")
    max_pages = int(data.get("max_pages") or resume.MAX_PAGES)

    def work() -> tuple[dict, dict]:
        doc = resume.master()
        master_pdf = resume.MASTER / "resume.pdf"
        master_pages = len(PdfReader(str(master_pdf)).pages) if master_pdf.is_file() else 4
        plan, usage = ai.resume_plan(store.get_application(app_id), doc, max_pages, master_pages)
        try:
            result = resume.build(app_id, plan, item["name"], ai._report, max_pages, store.get_application(app_id).get("resume_edits"))
        except resume.ResumeError as e:
            raise ai.AIError(str(e)) from e
        result["rationale"] = plan.get("rationale", "")
        return result, usage

    return _start_job("resume", f"Resume: {item['name']}", work, lambda r: store.update_application(app_id, {"resume": r}),
                      {"app_id": app_id}, strong=bool(data.get("strong")))


@app.get("/api/applications/{app_id:path}/resume.pdf")
def resume_pdf(app_id: str):
    return FileResponse(_not_found(resume.pdf_path, app_id), media_type="application/pdf")


@app.get("/api/resume/master")
def resume_master():
    """The master resume's sections and entries (ids and titles), for ticking them by hand."""
    try:
        return resume.outline()
    except resume.ResumeError as e:
        raise HTTPException(404, str(e)) from e


@app.post("/api/applications/{app_id:path}/resume/pick")
def resume_pick(app_id: str, data: dict = Body(...)):
    """Build this program's resume from the entries you ticked (no AI): verbatim chunks, compiled, saved in README `resume`."""
    item = _not_found(store.get_application, app_id)
    if not resume.tectonic():
        raise HTTPException(400, "Tectonic isn't installed, so the resume can't be compiled.")
    try:
        result = resume.pick(app_id, data.get("sections") or [], item["name"], item.get("resume_edits"))
    except resume.ResumeError as e:
        raise HTTPException(400, str(e)) from e
    result["rationale"] = ""
    result["picked"] = True
    return store.update_application(app_id, {"resume": result})


@app.post("/api/applications/{app_id:path}/resume/edit")
def resume_edit(app_id: str, data: dict = Body(...)):
    """Ask Claude to edit specific entries of this program's resume ("shorten the TA roles"). Edits apply to this program
    only, are checked and test-compiled before they're kept, and are saved in README `resume_edits` (revert any time)."""
    item = _not_found(store.get_application, app_id)
    instruction = (data.get("instruction") or "").strip()
    if not instruction:
        raise HTTPException(400, "Say what to change")
    plan = (item.get("resume") or {}).get("plan")
    if not plan:
        raise HTTPException(400, "Build the resume first, then ask for edits.")
    focus = data.get("focus") or None

    def work() -> tuple[dict, dict]:
        current = store.get_application(app_id)
        edits = dict(current.get("resume_edits") or {})
        chunks = resume.chunks(plan, edits)
        out, usage = ai.resume_edit(current, chunks, instruction, focus)
        by_id = {c["id"]: c for c in chunks}
        kept, skipped = [], list(out.get("dropped") or [])
        for ch in out.get("changes") or []:
            c = by_id.get(ch.get("id"))
            why = "it isn't in this resume" if not c else resume.check_edit(c["tex"], ch.get("tex") or "")
            if why:
                skipped.append(f"{c['title'] if c else ch.get('id')}: left alone, {why}")
            else:
                kept.append(ch)
                edits[c["id"]] = (ch["tex"].strip("\n") + "\n")
        if not kept:
            raise ai.AIError(" ".join([out.get("note") or "Claude didn't change anything."] + skipped))
        ai._report("Compiling the edited resume")
        try:
            built = resume.pick(app_id, plan, current["name"], edits)
        except resume.ResumeError as e:
            raise ai.AIError(f"The edit didn't compile, so nothing was changed. {e}") from e
        log = {"at": datetime.now().isoformat(timespec="minutes"), "instruction": instruction,
               "changes": [f"{by_id[c['id']]['title']}: {c['summary']}" for c in kept] + skipped, "note": out.get("note") or ""}
        return {"edits": edits, "resume": {**built, "rationale": "", "picked": True}, "log": log}, usage

    def save(r: dict) -> dict:
        log = [r["log"], *(store.get_application(app_id).get("resume_edit_log") or [])][:20]
        return store.update_application(app_id, {"resume_edits": r["edits"], "resume": r["resume"], "resume_edit_log": log})

    return _start_job("resume-edit", f"Resume edit: {item['name']}", work, save, {"app_id": app_id}, strong=bool(data.get("strong")))


@app.post("/api/applications/{app_id:path}/resume/revert")
def resume_revert(app_id: str, data: dict = Body(...)):
    """Drop this program's edit of one entry (or all of them) and rebuild with the master's text."""
    item = _not_found(store.get_application, app_id)
    plan = (item.get("resume") or {}).get("plan")
    edits = dict(item.get("resume_edits") or {})
    ids = data.get("ids") or list(edits)
    for i in ids:
        edits.pop(i, None)
    if plan:
        try:
            built = resume.pick(app_id, plan, item["name"], edits)
        except resume.ResumeError as e:
            raise HTTPException(400, str(e)) from e
        return store.update_application(app_id, {"resume_edits": edits, "resume": {**built, "rationale": "", "picked": True}})
    return store.update_application(app_id, {"resume_edits": edits})


@app.post("/api/applications/{app_id:path}/essays/{essay_id}/pdf")
def essay_make_pdf(app_id: str, essay_id: str):
    """Typeset the saved draft, exactly as written, to SOP.pdf / SOI.pdf / Essay-<id>.pdf beside it."""
    item = _not_found(store.get_application, app_id)
    essay = _essay(item, essay_id)
    try:
        path = essay_pdf.build(app_id, essay_id, essay["title"])
    except resume.ResumeError as e:
        raise HTTPException(400, str(e)) from e
    return {"file": path.name, "made_at": datetime.now().isoformat(timespec="seconds")}


@app.get("/api/applications/{app_id:path}/essays/{essay_id}/pdf")
def essay_get_pdf(app_id: str, essay_id: str):
    item = _not_found(store.get_application, app_id)
    _essay(item, essay_id)
    path = essay_pdf.pdf_path(app_id, essay_id)
    if not path.is_file():
        raise HTTPException(404, "No PDF yet")
    return FileResponse(path, media_type="application/pdf")


# Older single-SOP addresses; registered after /essays/... so ".../essays/sop" isn't taken for ".../sop".
@app.get("/api/applications/{app_id:path}/sop")
def get_sop(app_id: str):
    return {"text": _not_found(store.get_sop, app_id), "coach": store.get_coach_notes(app_id)}


@app.put("/api/applications/{app_id:path}/sop")
def put_sop(app_id: str, data: dict = Body(...)):
    _not_found(store.save_sop, app_id, data.get("text", ""))
    return {"ok": True}


@app.post("/api/applications/{app_id:path}/sop/outline")
def sop_outline(app_id: str, data: dict = Body(default={})):
    item = _not_found(store.get_application, app_id)
    return _start_job("sop-outline", item["name"], lambda: ai.sop_outline(store.get_application(app_id)), lambda r: store.add_coach_note(app_id, "Structure & pointers", r), {"app_id": app_id}, strong=bool(data.get("strong")))


@app.post("/api/applications/{app_id:path}/sop/review")
def sop_review(app_id: str, data: dict = Body(...)):
    item = _not_found(store.get_application, app_id)
    draft = data.get("text", "")
    return _start_job("sop-review", item["name"], lambda: ai.sop_review(item, draft), lambda r: store.add_coach_note(app_id, "Draft review", r), {"app_id": app_id}, strong=bool(data.get("strong")))


# Final folder: <application>/Final/ with the final version of every file you upload (final.py).
@app.get("/api/applications/{app_id:path}/final/file/{name}")
def final_file(app_id: str, name: str):
    return FileResponse(_not_found(final.file, app_id, name))


@app.get("/api/applications/{app_id:path}/final")
def final_list(app_id: str):
    return _not_found(final.listing, app_id)


@app.post("/api/applications/{app_id:path}/final")
def final_build(app_id: str):
    """Copy every final statement (typeset to PDF), the final resume, the transcript and score reports into Final/."""
    return _not_found(final.build, app_id)


@app.post("/api/applications/{app_id:path}/final/open")
def final_open(app_id: str):
    _not_found(final.open_folder, app_id)
    return {"ok": True}


@app.get("/api/applications/{app_id:path}")
def get_application(app_id: str):
    return _not_found(store.get_application, app_id)


@app.patch("/api/applications/{app_id:path}")
def update_application(app_id: str, patch: dict = Body(...)):
    return _not_found(store.update_application, app_id, patch)


@app.delete("/api/applications/{app_id:path}")
def delete_application(app_id: str):
    _not_found(store.delete_application, app_id)
    return {"ok": True}


def _replace_section(body: str, heading: str, content: str) -> str:
    """Replace (or append) a '## heading' section in a markdown body."""
    import re

    section = f"## {heading}\n\n{content.strip()}\n"
    pattern = re.compile(rf"^## {re.escape(heading)}\s*$.*?(?=^## |\Z)", re.M | re.S)
    if pattern.search(body):
        return pattern.sub(lambda _: section + "\n", body, count=1)
    return body.rstrip() + "\n\n" + section


# ---------------------------------------------------------------- discovery

@app.post("/api/discover")
def discover(data: dict = Body(...)):
    query = (data.get("query") or "").strip()
    kind = data.get("kind", "program")
    if not query:
        raise HTTPException(400, "Describe what you're looking for")
    existing = [f"{a['name']} — {a.get('university') or a.get('provider', '')}" for a in store.list_applications()]

    def remember(results: list) -> list:
        # Keep recent searches on disk so they survive page changes and restarts.
        entry = {"query": query, "kind": kind, "at": datetime.now().isoformat(timespec="seconds"), "results": results}
        history = [h for h in _discovery_history() if h["query"] != query]
        LOCAL.mkdir(parents=True, exist_ok=True)
        DISCOVERY.write_text(json.dumps([entry, *history][:DISCOVERY_KEEP]), encoding="utf-8")
        return results

    try:
        count = max(3, min(50, int(data.get("count") or 8)))
    except (TypeError, ValueError):
        count = 8
    return _start_job("discover", query, lambda: ai.find_candidates(query, kind, existing, count), remember,
                      {"query": query, "kind": kind, "count": count}, strong=bool(data.get("strong")))


DISCOVERY_KEEP = 12


def _discovery_history() -> list[dict]:
    if not DISCOVERY.is_file():
        return []
    data = json.loads(DISCOVERY.read_text(encoding="utf-8"))
    return data if isinstance(data, list) else [data]  # older files held a single search


@app.get("/api/discover/history")
def discover_history():
    return _discovery_history()


@app.delete("/api/discover/history/{index}")
def forget_search(index: int):
    history = _discovery_history()
    if 0 <= index < len(history):
        history.pop(index)
        DISCOVERY.write_text(json.dumps(history), encoding="utf-8")
    return history


# ---------------------------------------------------------------- exchange rates

FX_URL = "https://open.er-api.com/v6/latest/{base}"  # free, no key; rates are units of each currency per 1 base


@app.get("/api/fx")
def fx():
    """Exchange rates against your home currency (Profile `home_currency`), refreshed at most every 12 hours;
    falls back to the last saved rates when offline."""
    import time
    import urllib.request

    base = (str(store.get_profile().get("home_currency") or "USD").strip().upper())[:3] or "USD"
    cached = json.loads(FX_CACHE.read_text(encoding="utf-8")) if FX_CACHE.is_file() else None
    if cached and cached.get("base") != base:
        cached = None
    if cached and time.time() - cached.get("fetched", 0) < 12 * 3600:
        return cached
    try:
        with urllib.request.urlopen(FX_URL.format(base=base), timeout=8) as r:
            data = json.load(r)
        fresh = {"base": base, "rates": data["rates"], "updated": data.get("time_last_update_utc", ""), "fetched": time.time()}
        LOCAL.mkdir(parents=True, exist_ok=True)
        FX_CACHE.write_text(json.dumps(fresh), encoding="utf-8")
        return fresh
    except Exception as e:
        if cached:
            return {**cached, "stale": True}
        raise HTTPException(503, f"Exchange rates unavailable: {e}")


# ---------------------------------------------------------------- profile, recommenders, documents

@app.get("/api/profile")
def get_profile():
    return store.get_profile()


@app.put("/api/profile")
def put_profile(data: dict = Body(...)):
    return store.save_profile(data)


@app.get("/api/recommenders")
def recommenders():
    return store.list_recommenders()


@app.put("/api/recommenders/order")
def put_recommender_order(data: dict = Body(...)):
    ids = data.get("ids")
    if not isinstance(ids, list):
        raise HTTPException(400, "ids must be a list")
    return store.save_recommender_order(ids)


@app.delete("/api/recommenders/{rid}")
def remove_recommender(rid: str):
    return _not_found(store.remove_recommender, rid)


# Stages whose letters are being collected: the ones that live in Apply.
_APPLYING = ("preparing", "submitted", "interview", "decision")
_REFEREE = re.compile(r"refere|reference|letter|recommend", re.I)


def _letter_dates(item: dict) -> tuple[str, str]:
    """(application deadline, recommender deadline or "") as "15 December 2026". Past and done dates are skipped."""
    today = date.today().isoformat()
    dated = sorted((d for d in item.get("deadlines") or [] if re.fullmatch(r"\d{4}-\d{2}-\d{2}", d.get("date") or "") and not d.get("done") and d["date"] >= today),
                   key=lambda d: d["date"])
    fmt = lambda d: datetime.strptime(d["date"], "%Y-%m-%d").strftime("%#d %B %Y" if os.name == "nt" else "%-d %B %Y") if d else ""
    # Judge each date by its short name ("Application", "Referee deadline"), not the notes researched into its label.
    name = lambda d: re.split(r"[(;:.]", d.get("label") or "")[0]
    ref = next((d for d in dated if _REFEREE.search(name(d))), None)
    apply = next((d for d in dated if re.search(r"applica|admission", name(d), re.I) and not re.search(r"open|portal|start", name(d), re.I) and not _REFEREE.search(name(d))), None)
    return fmt(apply) or "not announced yet", fmt(ref)


@app.get("/api/recommenders/{rid}/email")
def get_letter_email(rid: str):
    return _not_found(store.get_letter_email, rid)


@app.put("/api/recommenders/{rid}/email")
def put_letter_email(rid: str, data: dict = Body(...)):
    _not_found(store.get_recommender, rid)
    return store.save_letter_email(rid, data.get("subject") or "", data.get("body") or "")


@app.post("/api/recommenders/{rid}/email")
def draft_letter_email(rid: str, data: dict = Body(default={})):
    """Draft the email that sends this recommender the list of applications they'll get invitations from: each one's
    application deadline and recommender deadline (if there is one). They've already agreed to write; nothing is sent."""
    person = _not_found(store.get_recommender, rid)
    letters = []
    for item in store.list_applications():
        mine = next((r for r in item.get("recommenders") or [] if r.get("id") == rid), None)
        if not mine or item.get("archived") or item.get("stage") not in _APPLYING:
            continue
        apply_by, letter_by = _letter_dates(item)
        letters.append({
            "university": item.get("university") or item.get("provider") or item["name"],
            "program": item["name"] if item.get("kind") == "program" else "Scholarship application",
            "application_deadline": apply_by,
            "recommender_deadline": letter_by,
        })
    if not letters:
        raise HTTPException(400, f"{person['name']} isn't on any application you're applying to yet. Add them on a program first.")
    return _start_job("letter-email", f"Email to {person['name']}", lambda: ai.letter_email(person, letters),
                      lambda r: store.save_letter_email(rid, r.get("subject") or "", r.get("body") or ""),
                      {"name": rid}, strong=bool(data.get("strong")))


@app.get("/api/documents")
def documents():
    return store.list_documents()


@app.get("/api/courses")
def courses():
    return store.courses()


@app.get("/api/files/{rel:path}")
def common_file(rel: str):
    path = _not_found(store.common_file, rel)
    return FileResponse(path)


@app.get("/api/usage")
def usage():
    if not USAGE_LOG.is_file():
        return []
    rows = [json.loads(line) for line in USAGE_LOG.read_text(encoding="utf-8").splitlines() if line.strip()]
    return list(reversed(rows))


# ---------------------------------------------------------------- frontend

DIST = APP_DIR / "frontend" / "dist"
if DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(404, "Not found")
        target = DIST / full_path
        if full_path and target.is_file():
            return FileResponse(target)
        return FileResponse(DIST / "index.html")
