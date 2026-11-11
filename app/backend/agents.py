"""Agent dispatcher: every AI task runs as a named agent with a role and a home building.

- Up to MAX_ACTIVE (3) agents work at once. The rest are formed and wait in the "town square",
  making no Claude calls, until a slot frees up.
- An agent can depend on others (a mission's Assessor waits for its Researcher, Accountant, Recruiter).
- Each agent records a live activity log, fed by ai.py while it works.
- Agents can be cancelled; a working agent's Claude process is killed.
- Finished agents are appended to <data root>/.app/agents.jsonl so the town's history survives restarts.
"""

from __future__ import annotations

import json
import os
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

import ai

MAX_ACTIVE = int(os.environ.get("AGENTS_MAX", "3"))
FINAL = {"done", "error", "cancelled"}

# kind of work -> (role, building)
ROLES: dict[str, tuple[str, str]] = {
    "discover": ("scout", "observatory"),
    "research": ("researcher", "library"),
    "faculty": ("recruiter", "faculty_hall"),
    "faculty-member": ("recruiter", "faculty_hall"),
    "faculty-deep": ("recruiter", "faculty_hall"),
    "funding": ("accountant", "bank"),
    "score": ("assessor", "admissions"),
    "course-check": ("assessor", "admissions"),
    "requirements": ("assessor", "admissions"),
    "sop-outline": ("coach", "studio"),
    "sop-review": ("coach", "studio"),
    "resume": ("coach", "studio"),
    "resume-edit": ("coach", "studio"),
    "letter-email": ("coach", "studio"),
    "ask": ("researcher", "library"),
    "tests": ("assessor", "admissions"),
}
NAMES: dict[str, list[str]] = {
    "scout": ["Iris", "Juno", "Vega", "Orion"],
    "researcher": ["Ada", "Rosalind", "Grace", "Emmy"],
    "recruiter": ["Rex", "Mina", "Theo", "Lark"],
    "accountant": ["Penny", "Otis", "Bea", "Cyrus"],
    "assessor": ["Otto", "Marlowe", "Ines", "Hale"],
    "coach": ["Quill", "Sage", "Wren", "Bram"],
}


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


class Dispatcher:
    def __init__(self, history_file: Path, on_usage: Callable[[str, str, dict], None]) -> None:
        self.history_file = history_file
        self.on_usage = on_usage
        self.jobs: dict[str, dict] = {}
        self.lock = threading.RLock()
        self.slots = threading.Semaphore(MAX_ACTIVE)
        self._cancel: dict[str, threading.Event] = {}
        self._done: dict[str, threading.Event] = {}
        self._procs: dict[str, Any] = {}
        self._load_history()

    # ------------------------------------------------------------ public

    def start(
        self,
        kind: str,
        label: str,
        work: Callable[[], tuple[Any, dict]],
        on_done: Callable[[Any], Any] | None = None,
        params: dict | None = None,
        mission: dict | None = None,
        depends_on: list[str] | None = None,
        model: str | None = None,
    ) -> dict:
        role, building = ROLES.get(kind, ("researcher", "library"))
        job_id = uuid.uuid4().hex[:12]
        with self.lock:
            job = {
                "id": job_id,
                "kind": kind,
                "role": role,
                "building": building,
                "agent": self._pick_name(role),
                "label": label,
                "params": params or {},
                "status": "waiting",
                "created": _now(),
                "started": None,
                "finished": None,
                "activity": [{"at": _now(), "text": "Dispatched from Town Hall"}],
                "mission": mission,
                "depends_on": depends_on or [],
                "model": model,
            }
            self.jobs[job_id] = job
            self._cancel[job_id] = threading.Event()
            self._done[job_id] = threading.Event()
        threading.Thread(target=self._run, args=(job, work, on_done), daemon=True).start()
        return self.public(job)

    def cancel(self, job_id: str) -> dict | None:
        job = self.jobs.get(job_id)
        if not job or job["status"] in FINAL:
            return job and self.public(job)
        self._cancel[job_id].set()
        proc = self._procs.get(job_id)
        if proc is not None:
            try:
                proc.kill()
            except OSError:
                pass
        self._log(job, "Cancelled by you")
        return self.public(job)

    def list(self) -> list[dict]:
        with self.lock:
            jobs = sorted(self.jobs.values(), key=lambda j: j["created"], reverse=True)
            return [self.public(j) for j in jobs]

    def get(self, job_id: str) -> dict | None:
        return self.jobs.get(job_id)

    @staticmethod
    def public(job: dict) -> dict:
        """Job without its (possibly large) result, for the frequently polled list."""
        return {k: v for k, v in job.items() if k != "result"}

    # ------------------------------------------------------------ internals

    def _pick_name(self, role: str) -> str:
        busy = {j["agent"] for j in self.jobs.values() if j["role"] == role and j["status"] not in FINAL}
        for name in NAMES.get(role, ["Agent"]):
            if name not in busy:
                return name
        return f"{NAMES.get(role, ['Agent'])[0]} {len(busy) + 1}"

    def _log(self, job: dict, text: str) -> None:
        with self.lock:
            job["activity"].append({"at": _now(), "text": text})
            del job["activity"][:-200]  # keep the log bounded

    def _finish(self, job: dict, status: str, **fields: Any) -> None:
        with self.lock:
            job.update(status=status, finished=_now(), **fields)
        self._done[job["id"]].set()
        self._persist(job)

    def _run(self, job: dict, work: Callable[[], tuple[Any, dict]], on_done: Callable[[Any], Any] | None) -> None:
        cancel = self._cancel[job["id"]]
        # Wait for teammates this agent builds on (e.g. the Assessor waits for the research team).
        if job["depends_on"]:
            self._log(job, "Waiting for teammates to report back")
            for dep in job["depends_on"]:
                ev = self._done.get(dep)
                while ev and not ev.wait(0.5):
                    if cancel.is_set():
                        break
        # Wait for a free slot; agents beyond the limit idle in the square.
        acquired = False
        while not cancel.is_set():
            if self.slots.acquire(timeout=0.5):
                acquired = True
                break
        if cancel.is_set():
            if acquired:
                self.slots.release()
            self._finish(job, "cancelled")
            return
        try:
            with self.lock:
                job.update(status="working", started=_now())
            self._log(job, "Arrived and started work")
            ai.bind_agent(
                report=lambda text: self._log(job, text),
                register_proc=lambda proc: self._procs.__setitem__(job["id"], proc),
                cancelled=cancel.is_set,
                model=job.get("model"),
            )
            result, usage = work()
            if cancel.is_set():
                raise ai.AIError("Cancelled")
            job["result"] = on_done(result) if on_done else result
            job["usage"] = usage
            self._log(job, "Delivered results")
            self._finish(job, "done", usage=usage, result_summary=_summarize(job["kind"], result))
            self.on_usage(job["kind"], job["label"], usage)
        except ai.AIError as e:
            if cancel.is_set():
                self._finish(job, "cancelled")
            else:
                self._log(job, f"Failed: {e}")
                self._finish(job, "error", error=str(e))
        except Exception as e:  # surface anything unexpected rather than losing it
            self._log(job, f"Failed: {type(e).__name__}")
            self._finish(job, "error", error=f"{type(e).__name__}: {e}")
        finally:
            ai.unbind_agent()
            self._procs.pop(job["id"], None)
            self.slots.release()

    def _persist(self, job: dict) -> None:
        try:
            self.history_file.parent.mkdir(parents=True, exist_ok=True)
            record = self.public(job)
            with self.history_file.open("a", encoding="utf-8") as f:
                f.write(json.dumps(record) + "\n")
        except OSError:
            pass

    def _load_history(self, keep: int = 80) -> None:
        if not self.history_file.is_file():
            return
        lines = self.history_file.read_text(encoding="utf-8").splitlines()[-keep:]
        for line in lines:
            try:
                job = json.loads(line)
            except json.JSONDecodeError:
                continue
            job["from_history"] = True
            self.jobs[job["id"]] = job
            done = threading.Event()
            done.set()
            self._done[job["id"]] = done


def _summarize(kind: str, result: Any) -> str:
    if kind == "discover" and isinstance(result, list):
        return f"Found {len(result)} candidates"
    if kind == "faculty" and isinstance(result, dict):
        return f"Mapped {len(result.get('faculty') or [])} faculty"
    if kind == "faculty-member" and isinstance(result, dict):
        return f"{str(result.get('match', '?')).capitalize()} match"
    if kind == "faculty-deep":
        return "Deep dive written"
    if kind == "score" and isinstance(result, dict):
        return f"Fit {result.get('fit')}/10, {result.get('tier')}"
    if kind == "requirements" and isinstance(result, dict):
        items = (result.get("checklist") or {}).get("items") or []
        met = sum(1 for r in items if r.get("status") == "met")
        return f"{len(items)} requirements, {met} met"
    if kind == "course-check" and isinstance(result, dict):
        reqs = result.get("requirements") or []
        met = sum(1 for r in reqs if r.get("status") == "met")
        return f"{str(result.get('verdict', '?')).capitalize()}: {met} of {len(reqs)} requirements met"
    if kind == "funding":
        return "Funding picture ready"
    if kind == "research":
        return "Profile written"
    if kind == "letter-email":
        return "Email drafted"
    if kind == "resume-edit" and isinstance(result, dict):
        n = len((result.get("log") or {}).get("changes") or [])
        return f"Edited {n} entr{'y' if n == 1 else 'ies'}"
    if kind == "resume" and isinstance(result, dict):
        return f"Resume: {result.get('pages')} pages"
    if kind.startswith("sop"):
        return "Coach notes written"
    if kind == "tests" and isinstance(result, dict):
        return f"{len(result.get('tests') or [])} tests on file"
    if kind == "ask" and isinstance(result, dict):
        n = len(result.get("changes") or [])
        return f"Answered, {n} change{'s' if n != 1 else ''}" if n else "Answered"
    return "Done"
