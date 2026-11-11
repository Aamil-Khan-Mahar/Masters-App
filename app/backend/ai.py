"""Claude-powered features: program discovery, research, scoring, SOP coaching.

Two ways to reach Claude:
  - "api":         the Anthropic API, billed per token (needs ANTHROPIC_API_KEY).
  - "claude-code": the local Claude Code CLI in headless mode (`claude -p`), which
                   runs on the user's Claude subscription. Calls count toward the
                   plan's usage limits instead of costing money.
AI_BACKEND=auto (default) uses the API when a key is set, otherwise Claude Code.

Every public function returns (result, usage) where usage is a dict of token
counts and an estimated USD cost, so the UI can show what each call spent.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
from urllib.parse import urlparse
from datetime import date

import anthropic
import yaml

import store

# Sonnet is the default for every task; any task can ask for Opus ("strong") when it needs more.
MODEL = os.environ.get("CLAUDE_MODEL", "claude-sonnet-5-5")
MODEL_STRONG = os.environ.get("CLAUDE_MODEL_STRONG", "claude-opus-5-5")
# Scoring is a short judgement over text we already have, so it runs on Haiku. SOP coaching stays on MODEL.
MODEL_LIGHT = os.environ.get("CLAUDE_MODEL_LIGHT", "claude-haiku-5-5")

# USD per million tokens (input, output). Web search is billed per search.
PRICES = {
    "claude-fable-5-1": (10.0, 50.0),
    "claude-opus-5-5": (4.0, 20.0),
    "claude-sonnet-5-5": (2.0, 10.0),
    "claude-haiku-5-5": (0.10, 0.50),
}
WEB_SEARCH_USD = 10.0 / 1000
# Server-side refusal fallback is supported on these models (Claude API only).
FALLBACK_MODELS = {"claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5"}

WEB_SEARCH = {"type": "web_search_20260209", "name": "web_search"}
WEB_FETCH = {"type": "web_fetch_20260209", "name": "web_fetch"}
# (searches, page fetches) a web task may use. Fetched pages are most of a research task's input tokens.
WEB_BUDGET = (6, 12)


SOURCE_RULES = """

Sources: work from the institution's own websites (the university, faculty, department, graduate school,
program and lab pages, or the funder's own site for a scholarship). Start from the official page you were
given or find it first, and follow links within official domains. Use search only to locate official pages.
Don't take facts from rankings, aggregators (e.g. Mastersportal, FindAMasters, Yocket), forums, blogs or
consultancies; if something is only published there, leave the field empty or mark it unconfirmed.
Every URL in `sources` should be an official page."""


def _budget_note(budget: tuple[int, int]) -> str:
    searches, fetches = budget
    return (f"{SOURCE_RULES}\n\nTool budget: at most {searches} web searches and {fetches} page fetches in total. "
            "Don't fetch a page you already have, and stop as soon as you have enough to answer.")

_client: anthropic.Anthropic | None = None


class AIError(Exception):
    pass


_agent = threading.local()


def bind_agent(report, register_proc, cancelled, model: str | None = None) -> None:
    """Called by the dispatcher on the agent's thread before it starts work.
    `model` overrides the task's default (used when the user asks for Opus)."""
    _agent.report, _agent.register_proc, _agent.cancelled, _agent.model = report, register_proc, cancelled, model


def unbind_agent() -> None:
    _agent.__dict__.clear()


def _report(text: str) -> None:
    fn = getattr(_agent, "report", None)
    if fn:
        fn(text[:240])


def _short_url(url: str) -> str:
    u = urlparse(url)
    path = u.path.rstrip("/")
    if len(path) > 48:
        path = "…" + path[-46:]
    return (u.netloc.removeprefix("www.") + path) or url[:60]


def _describe_tool(name: str, inp: dict) -> str | None:
    if name in ("WebSearch", "web_search"):
        return f"Searching: {inp.get('query', '')}"
    if name in ("WebFetch", "web_fetch"):
        return f"Reading {_short_url(inp.get('url', ''))}"
    if name == "StructuredOutput" or name.startswith("submit_"):
        return "Writing up the results"
    return None


def client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic(timeout=600)
    return _client


def _has_api_key() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))


def _claude_cli() -> str | None:
    return shutil.which("claude")


def backend() -> str | None:
    """Which way to reach Claude: 'api', 'claude-code', or None if neither is available."""
    choice = os.environ.get("AI_BACKEND", "auto").strip().lower()
    if choice in ("off", "none"):
        return None
    if choice == "api":
        return "api" if _has_api_key() else None
    if choice in ("claude-code", "cli", "subscription"):
        return "claude-code" if _claude_cli() else None
    if _has_api_key():
        return "api"
    return "claude-code" if _claude_cli() else None


def configured() -> bool:
    return backend() is not None


# ---------------------------------------------------------------- plumbing

class Usage:
    def __init__(self, model: str | None = None) -> None:
        self.model = getattr(_agent, "model", None) or model or MODEL
        self.input = self.output = self.cache_read = self.cache_write = self.searches = 0
        self.cli_cost = 0.0
        self.backend = backend()

    def add(self, u) -> None:
        self.input += u.input_tokens or 0
        self.output += u.output_tokens or 0
        self.cache_read += getattr(u, "cache_read_input_tokens", 0) or 0
        self.cache_write += getattr(u, "cache_creation_input_tokens", 0) or 0
        stu = getattr(u, "server_tool_use", None)
        self.searches += (getattr(stu, "web_search_requests", 0) or 0) if stu else 0

    def add_cli(self, result: dict) -> None:
        u = result.get("usage") or {}
        self.input += u.get("input_tokens", 0) or 0
        self.output += u.get("output_tokens", 0) or 0
        self.cache_read += u.get("cache_read_input_tokens", 0) or 0
        self.cache_write += u.get("cache_creation_input_tokens", 0) or 0
        # Claude Code reports its own WebSearch calls per model, not under server_tool_use.
        self.searches += sum((m or {}).get("webSearchRequests", 0) or 0 for m in (result.get("modelUsage") or {}).values()) or (
            (u.get("server_tool_use") or {}).get("web_search_requests", 0) or 0
        )
        self.cli_cost += result.get("total_cost_usd") or 0

    def to_dict(self) -> dict:
        if self.backend == "claude-code":
            # On a subscription nothing is billed; keep the list-price equivalent for reference.
            return {
                "backend": "claude-code",
                "model": self.model,
                "input_tokens": self.input + self.cache_read + self.cache_write,
                "output_tokens": self.output,
                "web_searches": self.searches,
                "cost_usd": 0.0,
                "equivalent_api_usd": round(self.cli_cost, 4),
            }
        pin, pout = PRICES.get(self.model, PRICES["claude-opus-5-5"])
        cost = (
            self.input * pin
            + self.cache_write * pin * 1.25
            + self.cache_read * pin * 0.1
            + self.output * pout
        ) / 1_000_000 + self.searches * WEB_SEARCH_USD
        return {
            "backend": "api",
            "model": self.model,
            "input_tokens": self.input + self.cache_read + self.cache_write,
            "output_tokens": self.output,
            "web_searches": self.searches,
            "cost_usd": round(cost, 4),
        }


def _create(usage: Usage, max_tokens: int = 16000, **kwargs):
    extra = {}
    if usage.model in FALLBACK_MODELS:
        extra = {"betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default"}
    try:
        resp = client().beta.messages.create(model=usage.model, max_tokens=max_tokens, **extra, **kwargs)
    except anthropic.AuthenticationError as e:
        raise AIError("Anthropic API key is missing or invalid. Set ANTHROPIC_API_KEY in app/.env.") from e
    except anthropic.RateLimitError as e:
        raise AIError("Rate limited by the Anthropic API. Try again in a minute.") from e
    except anthropic.APIStatusError as e:
        raise AIError(f"Anthropic API error ({e.status_code}): {e.message}") from e
    except anthropic.APIConnectionError as e:
        raise AIError("Could not reach the Anthropic API. Check your connection.") from e
    usage.add(resp.usage)
    if resp.stop_reason == "refusal":
        raise AIError("Claude declined this request.")
    return resp


def _text(resp) -> str:
    return "".join(b.text for b in resp.content if b.type == "text").strip()


def _latex_to_text(tex: str) -> str:
    """Resume LaTeX as plain text: same facts, roughly half the tokens."""
    tex = re.sub(r"(?m)^\s*%.*$", "", tex)  # comment lines
    tex = re.sub(r"\\href\{[^}]*\}\{([^}]*)\}", r"\1", tex)
    tex = re.sub(r"\\(textbf|textit|underline|emph|small|normalfont)\{([^}]*)\}", r"\2", tex)
    tex = re.sub(r"\\resume(Sub)?[Hh]eading\s*\{([^}]*)\}\{([^}]*)\}\s*\{([^}]*)\}\{([^}]*)\}", r"\n## \2 | \3 | \4 | \5", tex)
    tex = re.sub(r"\\resumeProjectHeading\{([^}]*)\}\{([^}]*)\}", r"\n## \1 \2", tex)
    tex = re.sub(r"\\resumeItem(Label)?\{", "- ", tex)
    tex = re.sub(r"\\section\{([^}]*)\}", r"\n# \1", tex)
    tex = re.sub(r"\\[a-zA-Z]+(\[[^\]]*\])?", "", tex)  # remaining commands
    tex = tex.replace("$\\sim$", "~").replace("\\&", "&").replace("\\%", "%").replace("\\$", "$").replace("--", "–")
    tex = re.sub(r"[{}]", "", tex)
    tex = re.sub(r"[ \t]+", " ", tex)
    return re.sub(r"\n\s*\n+", "\n", tex).strip()


def _context(full: bool = False) -> str:
    """Applicant context. Everyone gets the profile (which summarises the resume) and test scores;
    `full` adds the resume itself, for tasks that judge or coach the applicant in detail."""
    profile = store.get_profile()
    body = profile.pop("body", "")
    for k in ("exists", "shortlist_weights"):
        profile.pop(k, None)
    parts = ["<profile>\n" + yaml.safe_dump(profile, sort_keys=False, allow_unicode=True) + body + "\n</profile>"]
    if full:
        resume = store.resume_text()
        if resume:
            parts.append("<resume>\n" + _latex_to_text(resume) + "\n</resume>")
    scores = store.read_text_if_exists(store.COMMON / "Test-Scores" / "Test-Scores.md")
    if scores:
        parts.append("<test_scores>\n" + scores + "\n</test_scores>")
    return "\n\n".join(parts)


# What each task needs to know about a program/scholarship. Everything else stays out of the prompt.
_IDENTITY = ("kind", "name", "university", "provider", "country", "city", "degree", "url", "intake")
BRIEF_FIELDS: dict[str, tuple[str, ...]] = {
    "research": _IDENTITY,
    "faculty": (*_IDENTITY, "format", "overview"),
    "funding": (*_IDENTITY, "format", "duration", "tuition", "tuition_usd_per_year", "living_usd_per_year", "funding"),
    "score": (*_IDENTITY, "format", "duration", "overview", "admission", "deadlines", "tuition_usd_per_year",
              "living_usd_per_year", "funding_details", "outcomes", "faculty_profiles", "coverage", "eligibility", "course_check", "requirements_check"),
    "course_check": (*_IDENTITY, "admission", "sources"),
    "sop": (*_IDENTITY, "format", "overview", "structure", "courses", "admission", "sop_prompt", "faculty_profiles", "labs", "outcomes",
            "coverage", "eligibility", "selection", "awards_per_year"),
    "resume": (*_IDENTITY, "format", "overview", "structure", "courses", "admission", "faculty_profiles", "labs", "outcomes"),
}


def _item_brief(item: dict, task: str) -> str:
    meta = {k: item[k] for k in BRIEF_FIELDS[task] if item.get(k) not in (None, "", [], {})}
    # Faculty: only the people who matter, in one line each.
    if "faculty_profiles" in meta:
        meta["faculty_profiles"] = [
            f"{f['name']} ({f.get('match', '?')} match): {f.get('research', '')[:160]}"
            for f in meta["faculty_profiles"] if f.get("match") in ("strong", "possible")
        ][:10]
    if "funding_details" in meta:
        fd = meta["funding_details"]
        meta["funding_details"] = {k: fd.get(k) for k in ("summary", "guaranteed", "typical_package_usd_per_year") if fd.get(k)}
    if "course_check" in meta:
        cc = meta["course_check"]
        meta["course_check"] = {"verdict": cc.get("verdict"), "summary": cc.get("summary"), "gaps": (cc.get("gaps") or [])[:5]}
    return yaml.safe_dump(meta, sort_keys=False, allow_unicode=True, width=200)


def _run_with_submit(usage: Usage, system: str, prompt: str, submit_tool: dict, budget: tuple[int, int] = WEB_BUDGET, max_rounds: int = 8) -> dict:
    """Let Claude search the web, then require it to hand results to `submit_tool`."""
    tools = [{**WEB_SEARCH, "max_uses": budget[0]}, {**WEB_FETCH, "max_uses": budget[1]}, {**submit_tool, "strict": True}]
    messages: list = [{"role": "user", "content": prompt}]
    nudged = False
    for _ in range(max_rounds):
        _report("Thinking it through")
        resp = _create(usage, system=system, tools=tools, messages=messages, output_config={"effort": "medium"})
        for block in resp.content:
            if block.type in ("server_tool_use", "tool_use"):
                text = _describe_tool(block.name, dict(block.input or {}))
                if text:
                    _report(text)
        for block in resp.content:
            if block.type == "tool_use" and block.name == submit_tool["name"]:
                return block.input
        messages.append({"role": "assistant", "content": resp.content})
        if resp.stop_reason == "pause_turn":
            continue  # server-side search loop paused; resend to resume
        if nudged:
            break
        nudged = True
        messages.append({"role": "user", "content": f"Now call {submit_tool['name']} with your findings."})
    raise AIError("Claude finished without returning structured results. Try again.")


CLI_TIMEOUT_S = 20 * 60


def _cli(usage: Usage, system: str, prompt: str, *, schema: dict | None = None, web: bool = False, effort: str = "medium") -> dict:
    """Run one headless Claude Code turn. Returns the CLI's JSON result object.

    Runs in an empty temp directory with no settings, MCP servers or file tools,
    so Claude Code only sees the prompt (plus web search/fetch when asked).
    """
    exe = _claude_cli()
    if not exe:
        raise AIError("Claude Code isn't installed or isn't on PATH.")
    tools = ["WebSearch", "WebFetch"] if web else []
    cmd = [
        exe, "-p",
        # Stream events so the agent's log shows each search and page read as it happens.
        "--verbose", "--output-format", "stream-json",
        "--no-session-persistence",
        "--strict-mcp-config",
        "--setting-sources", "",
        "--model", usage.model,
        "--effort", effort,
        "--system-prompt", system,
    ]
    if schema:
        cmd += ["--json-schema", json.dumps(schema)]
    if tools:
        cmd += ["--allowedTools", *tools]
    cmd += ["--tools", ",".join(tools)]
    # Without an API key in the environment, Claude Code uses the subscription login.
    env = {k: v for k, v in os.environ.items() if k not in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN")}
    result: dict = {}
    started = time.monotonic()
    with tempfile.TemporaryDirectory() as cwd, tempfile.TemporaryFile("w+", encoding="utf-8") as err:
        proc = subprocess.Popen(
            cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=err,
            text=True, encoding="utf-8", cwd=cwd, env=env,
        )
        register = getattr(_agent, "register_proc", None)
        if register:
            register(proc)
        proc.stdin.write(prompt)
        proc.stdin.close()
        _report("Reading your profile and the brief")
        for line in proc.stdout:
            if time.monotonic() - started > CLI_TIMEOUT_S:
                proc.kill()
                raise AIError("Claude Code took too long and was stopped.")
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if event.get("type") == "assistant":
                for block in event.get("message", {}).get("content", []):
                    if block.get("type") == "tool_use":
                        text = _describe_tool(block.get("name", ""), block.get("input") or {})
                        if text:
                            _report(text)
            elif event.get("type") == "result":
                result = event
        proc.wait()
        cancelled = getattr(_agent, "cancelled", None)
        if cancelled and cancelled():
            raise AIError("Cancelled")
        if not result:
            err.seek(0)
            detail = err.read().strip()[-400:] or f"exit code {proc.returncode}"
            raise AIError(f"Claude Code failed: {detail}. Run `claude` once in a terminal to check you're logged in.")
    usage.add_cli(result)
    if result.get("is_error"):
        raise AIError(f"Claude Code error: {str(result.get('result') or result.get('subtype'))[:400]}")
    return result


def _structured(usage: Usage, system: str, prompt: str, schema: dict, *, web: bool, tool_name: str = "", tool_desc: str = "",
                effort: str = "medium", budget: tuple[int, int] = WEB_BUDGET, max_tokens: int = 16000) -> dict:
    """Get JSON matching `schema`, optionally after searching the web within `budget`."""
    if web:
        system += _budget_note(budget)
    if usage.backend == "claude-code":
        result = _cli(usage, system, prompt, schema=schema, web=web, effort=effort)
        data = result.get("structured_output")
        if data is None:
            try:
                data = json.loads(result.get("result") or "")
            except json.JSONDecodeError as e:
                raise AIError("Claude Code didn't return structured results. Try again.") from e
        return data
    if web:
        return _run_with_submit(usage, system, prompt, {"name": tool_name, "description": tool_desc, "input_schema": schema}, budget)
    resp = _create(
        usage,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": prompt}],
        output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}},
    )
    if resp.stop_reason == "max_tokens":
        raise AIError("The answer was longer than the output limit and got cut off. Try again.")
    return json.loads(_text(resp))


def _complete(usage: Usage, system: str, prompt: str, *, effort: str = "high") -> str:
    """Plain markdown answer, no tools."""
    _report("Thinking it through")
    if usage.backend == "claude-code":
        return (_cli(usage, system, prompt, effort=effort).get("result") or "").strip()
    resp = _create(usage, system=system, messages=[{"role": "user", "content": prompt}], output_config={"effort": effort})
    return _text(resp)


# ---------------------------------------------------------------- discovery

CANDIDATE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["candidates"],
    "properties": {
        "candidates": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["name", "university", "provider", "country", "city", "degree", "url", "why", "deadline_hint"],
                "properties": {
                    "name": {"type": "string", "description": "Official program or scholarship name"},
                    "university": {"type": "string", "description": "University (programs); empty for scholarships"},
                    "provider": {"type": "string", "description": "Funding body (scholarships); empty for programs"},
                    "country": {"type": "string"},
                    "city": {"type": "string"},
                    "degree": {"type": "string", "description": "e.g. MSc, MS, MEng, MMath; empty for scholarships"},
                    "url": {"type": "string", "description": "Official page"},
                    "why": {"type": "string", "description": "One or two sentences on why it fits this applicant"},
                    "deadline_hint": {"type": "string", "description": "Next known deadline, or empty"},
                },
            },
        }
    },
}

DISCOVERY_SYSTEM = """You help a prospective graduate student find master's programs and scholarships.
Use web search to find real, currently offered options and verify each one on an official page.
Never invent a program.
Skip anything the applicant already tracks. Return as many strong candidates as the request asks for; return fewer
only when fewer genuinely fit, and never pad the list with weak or unverified ones."""


def find_candidates(query: str, kind: str, existing: list[str], count: int = 8) -> tuple[list[dict], dict]:
    usage = Usage()
    count = max(3, min(50, int(count)))
    # More results need more searching to verify each one on an official page (capped so one search stays bounded).
    budget = (min(30, max(WEB_BUDGET[0], count // 2 + 2)), min(60, max(WEB_BUDGET[1], count + 4)))
    what = "master's programs" if kind == "program" else "scholarships for a master's degree"
    prompt = (
        f"{_context()}\n\n<already_tracking>\n" + "\n".join(existing) + "\n</already_tracking>\n\n"
        f"Find {count} {what} matching this request: {query}\n\nToday is {date.today().isoformat()}."
    )
    result = _structured(
        usage, DISCOVERY_SYSTEM, prompt, CANDIDATE_SCHEMA, web=True, budget=budget,
        tool_name="submit_candidates", tool_desc=f"Submit the verified list of {what}.",
    )
    return result["candidates"], usage.to_dict()


# ---------------------------------------------------------------- research

_STR = {"type": "string"}
_STRS = {"type": "array", "items": {"type": "string"}}
_DEADLINES = {
    "type": "array",
    "items": {
        "type": "object",
        "additionalProperties": False,
        "required": ["label", "date"],
        "properties": {
            "label": {"type": "string", "description": "e.g. 'Application (international)', 'Funding consideration'"},
            "date": {"type": "string", "description": "YYYY-MM-DD"},
        },
    },
}

_ADMISSION = {
    "type": "object",
    "additionalProperties": False,
    "description": "Admission requirements broken down. Empty string / empty list when the program doesn't publish one.",
    "required": ["gpa", "english", "gre", "background", "prerequisites", "documents", "letters", "notes"],
    "properties": {
        "gpa": {"type": "string", "description": "Minimum grade/GPA as published, e.g. 'B+ (78%) in the last two years'"},
        "english": {"type": "string", "description": "English test minimums, e.g. 'TOEFL iBT 93 (W25, S22) or IELTS 7.0'"},
        "gre": {"type": "string", "description": "GRE policy: required / optional / not accepted, with scores if stated"},
        "background": {"type": "string", "description": "Required undergraduate background, e.g. 'Honours degree in CS, Statistics or related'"},
        "prerequisites": {"type": "array", "items": {"type": "string"}, "description": "Specific courses or knowledge expected"},
        "documents": {"type": "array", "items": {"type": "string"}, "description": "Documents to submit: SOP, CV, transcripts, writing sample, etc."},
        "letters": {"type": "string", "description": "Number and kind of reference letters, e.g. '3 letters, at least 2 academic'"},
        "notes": {"type": "string", "description": "Anything else that matters: supervisor needed before applying, interviews, quotas"},
    },
}

_FACULTY = {
    "type": "array",
    "description": "4 to 8 faculty members whose research best matches the applicant's interests. Only real, current faculty verified on official pages.",
    "items": {
        "type": "object",
        "additionalProperties": False,
        "required": ["name", "title", "department", "research", "why", "url", "accepting", "match"],
        "properties": {
            "name": {"type": "string"},
            "department": {"type": "string", "description": "Department or school, e.g. 'Statistics & Actuarial Science'"},
            "match": {"type": "string", "enum": ["strong", "possible", "weak"], "description": "How well their research fits the applicant's interests and background"},
            "title": {"type": "string", "description": "e.g. 'Associate Professor, David R. Cheriton School of Computer Science'"},
            "research": {"type": "string", "description": "Two or three sentences on what they work on"},
            "why": {"type": "string", "description": "One or two sentences on why they fit this applicant specifically"},
            "url": {"type": "string", "description": "Faculty profile or lab page"},
            "accepting": {"type": "string", "enum": ["yes", "no", "unknown"], "description": "Whether they say they are taking new master's students"},
        },
    },
}

_LABS = {
    "type": "array",
    "description": "Research labs, groups or institutes relevant to the applicant",
    "items": {
        "type": "object",
        "additionalProperties": False,
        "required": ["name", "focus", "url"],
        "properties": {"name": _STR, "focus": _STR, "url": _STR},
    },
}

PROGRAM_RESEARCH_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "url", "city", "degree", "intake", "duration", "deadlines", "tuition", "tuition_usd_per_year",
        "living_usd_per_year", "application_fee", "application_fee_currency", "funding", "requirements",
        "overview", "format", "structure", "courses", "admission", "faculty_profiles", "labs", "outcomes",
        "sop_prompt", "sources", "summary",
    ],
    "properties": {
        "overview": {"type": "string", "description": "Two short paragraphs, plain prose: what the program is, who it's for, what makes it distinctive"},
        "format": {"type": "string", "description": "One short phrase, e.g. 'Thesis-based, research', 'Course-based with co-op', 'Course-based with research project'"},
        "structure": {"type": "string", "description": "How the program is organised: terms, required vs elective courses, thesis/project/internship, typical length"},
        "courses": {"type": "array", "items": {"type": "string"}, "description": "Notable core and elective courses relevant to the applicant (names only)"},
        "admission": _ADMISSION,
        "faculty_profiles": _FACULTY,
        "labs": _LABS,
        "outcomes": {"type": "string", "description": "Where graduates go, placement data if published, and post-study work rights for international students"},
        "sop_prompt": {"type": "string", "description": "The program's statement-of-purpose prompt and length limit if published, else empty"},
        "url": _STR,
        "city": _STR,
        "degree": _STR,
        "intake": {"type": "string", "description": "Next intake the applicant can target, e.g. 'Fall 2027'"},
        "duration": _STR,
        "deadlines": _DEADLINES,
        "tuition": {"type": "string", "description": "Tuition as published, with currency and period"},
        "tuition_usd_per_year": {"type": ["number", "null"], "description": "Approximate international tuition per year in USD"},
        "living_usd_per_year": {"type": ["number", "null"], "description": "Approximate living cost per year in USD"},
        "application_fee": {"type": ["number", "null"]},
        "application_fee_currency": _STR,
        "funding": {"type": "string", "description": "Funding available to master's students: TA/RA, stipends, fee waivers, named awards"},
        "requirements": {"type": "array", "items": {"type": "string"}, "description": "Admission requirements, one per item (GPA, English test minimums, GRE, prerequisites, documents, number of letters)"},
        "sources": {"type": "array", "items": {"type": "string"}, "description": "URLs you relied on"},
        "summary": {"type": "string", "description": "Markdown research notes: program focus, structure, notable faculty/labs relevant to the applicant, career outcomes, post-study work rights, anything unusual. Use ### subheadings."},
    },
}

SCHOLARSHIP_RESEARCH_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["url", "provider", "country", "coverage", "deadlines", "eligibility", "requirements", "overview", "selection", "awards_per_year", "essays", "sources", "summary"],
    "properties": {
        "essays": {
            "type": "array",
            "description": "Every essay or written statement the scholarship application asks for, from the official page. Empty if none are published.",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "type", "title", "prompt", "limit"],
                "properties": {
                    "id": {"type": "string", "description": "Short lowercase id, letters, digits and hyphens, e.g. 'leadership', 'personal', 'study-plan'"},
                    "type": {"type": "string", "enum": ["sop", "soi", "personal", "research", "other"]},
                    "title": {"type": "string", "description": "The essay's name as the funder words it, e.g. 'Leadership and influence'"},
                    "prompt": {"type": "string", "description": "The exact wording of the question, else empty"},
                    "limit": {"type": ["integer", "null"], "description": "Word limit; convert a character limit to about a sixth of it in words. Null if none"},
                },
            },
        },
        "overview": {"type": "string", "description": "Two short paragraphs, plain prose: what the scholarship is, who it's for, what it expects of recipients (e.g. return-home obligations)"},
        "selection": {"type": "array", "items": {"type": "string"}, "description": "Selection criteria and what the panel looks for, one per item"},
        "awards_per_year": {"type": "string", "description": "Number of awards per year or acceptance rate if published, else empty"},
        "url": _STR,
        "provider": _STR,
        "country": {"type": "string", "description": "Host country/countries where study is funded"},
        "coverage": {"type": "string", "description": "What is covered: tuition, stipend amount, travel, etc."},
        "deadlines": _DEADLINES,
        "eligibility": {"type": "array", "items": {"type": "string"}, "description": "Eligibility criteria, one per item"},
        "requirements": {"type": "array", "items": {"type": "string"}, "description": "Documents and steps required to apply"},
        "sources": _STRS,
        "summary": {"type": "string", "description": "Markdown notes: selection criteria, what makes a strong application, whether this applicant is eligible and how competitive they are, which programs it pairs with. Use ### subheadings."},
    },
}

RESEARCH_SYSTEM = """You research graduate admissions details for one applicant.
Use web search and confirm facts on official pages. Dates must be the upcoming cycle's dates;
if a date for the upcoming cycle is not yet published, use last cycle's date and say so in the label
(e.g. 'Application (2026 date, unconfirmed)'). Leave a field empty or null rather than guess.
For faculty, prefer people whose work matches the applicant's interests and background; check each one is
current faculty in that department and link their official page. Never invent people, courses or numbers.
In the summary, tie what you found to this applicant's background where it matters."""


def research(item: dict) -> tuple[dict, dict]:
    usage = Usage()
    kind = item["kind"]
    schema = PROGRAM_RESEARCH_SCHEMA if kind == "program" else SCHOLARSHIP_RESEARCH_SCHEMA
    prompt = (
        f"{_context()}\n\n<entry_to_research>\n{_item_brief(item, 'research')}\n</entry_to_research>\n\n"
        f"Research this {kind} thoroughly for the applicant above. Today is {date.today().isoformat()}."
    )
    result = _structured(
        usage, RESEARCH_SYSTEM, prompt, schema, web=True,
        tool_name="submit_research", tool_desc=f"Submit the researched details for this {kind}.",
    )
    return result, usage.to_dict()


# ---------------------------------------------------------------- faculty directory

# Two steps, so nothing recurses: copy the names off the supervisors page, then research people one at a time.

FACULTY_LIST_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["faculty"],
    "properties": {
        "faculty": {
            "type": "array",
            "description": "Every person listed on the directory page, in the page's order. Do not drop anyone and do not add people who aren't listed.",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["name", "title", "department", "research", "url"],
                "properties": {
                    "name": _STR,
                    "title": {"type": "string", "description": "Title as listed, else empty"},
                    "department": {"type": "string", "description": "Department or school as listed, else empty"},
                    "research": {"type": "string", "description": "Research areas exactly as the directory page lists them, else empty"},
                    "url": {"type": "string", "description": "Their profile link from the directory page, else empty"},
                },
            },
        }
    },
}

FACULTY_LIST_SYSTEM = """You copy the list of potential supervisors from one official directory page.
Open the page you are given and list every person on it with whatever the page itself shows: name, title,
department, research areas and profile link. Do not open individual profiles and do not search for anyone;
the applicant researches people one at a time later. If the list is split across pages of the same site
(pagination or A-Z tabs), open those too. Copy, don't infer: leave a field empty if the page doesn't show it. Leave people out only if the request says to."""


def faculty_list(item: dict, url: str, extra: bool = False) -> tuple[dict, dict]:
    usage = Usage()
    page = (
        f"A department contacts or faculty page linked to this program (not its official supervisors list): {url}\n\n"
        "List every faculty member or researcher on it. Leave out administrative and support staff (coordinators, advisors, assistants)."
        if extra else f"Potential supervisors page for this program: {url}\n\nList everyone on it."
    )
    prompt = f"<program>\n{_item_brief(item, 'faculty')}\n</program>\n\n{page}"
    result = _structured(
        usage, FACULTY_LIST_SYSTEM, prompt, FACULTY_LIST_SCHEMA, web=True, budget=(1, 6), effort="low",
        tool_name="submit_faculty", tool_desc="Submit everyone listed on the directory page.",
    )
    return result, usage.to_dict()


FACULTY_MEMBER_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["title", "department", "research", "why", "url", "accepting", "match"],
    "properties": {k: v for k, v in _FACULTY["items"]["properties"].items() if k != "name"},
}

FACULTY_MEMBER_SYSTEM = """You research one potential supervisor for one graduate applicant.
Read their official faculty profile and, if they have one, their lab or academic home page. Summarise what they
work on now in two or three sentences, then judge the fit with this applicant: 'strong' when their research
clearly matches the applicant's interests and background, 'possible' for partial overlap, 'weak' otherwise.
Say whether they state they are taking master's students ('unknown' if not stated). Never invent research areas."""


def faculty_member(item: dict, person: dict) -> tuple[dict, dict]:
    usage = Usage()
    known = {k: person[k] for k in ("name", "title", "department", "research", "url") if person.get(k)}
    prompt = (
        f"{_context()}\n\n<program>\n{_item_brief(item, 'faculty')}\n</program>\n\n"
        f"<person>\n{yaml.safe_dump(known, sort_keys=False, allow_unicode=True, width=200)}</person>\n\n"
        "Research this person for the applicant."
    )
    result = _structured(
        usage, FACULTY_MEMBER_SYSTEM, prompt, FACULTY_MEMBER_SCHEMA, web=True, budget=(2, 4),
        tool_name="submit_person", tool_desc="Submit the research on this person.",
    )
    return result, usage.to_dict()


FACULTY_DEEP_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": [*FACULTY_MEMBER_SCHEMA["required"], "profile", "sources"],
    "properties": {
        **FACULTY_MEMBER_SCHEMA["properties"],
        "profile": {"type": "string", "description": "The full deep dive in markdown, using the headings asked for"},
        "sources": {"type": "array", "items": {"type": "string"}, "description": "URLs actually read"},
    },
}

FACULTY_DEEP_SYSTEM = """You write an in-depth profile of one potential supervisor for one graduate applicant, so the applicant
can decide whether to contact them and what to talk about. Read their official profile, lab or home page, Google Scholar
or DBLP, and recent papers. Only state what you found; write 'Not found' rather than guess. Cite papers with year and
venue and link them when you can. In the fit and approach sections be concrete: name the applicant's own projects or
experience that connect to specific papers or projects of theirs. Do not draft emails or paragraphs for the applicant.

Use exactly these markdown headings, in order:
## At a glance            (4-6 bullets: position, department, research focus, lab, accepting students, best fit angle)
## Background             (education, previous positions, notable awards)
## Research themes        (each theme in a short paragraph: questions they ask, methods they use)
## Recent work            (5-10 papers or projects from the last ~3 years, one line each on what it does)
## Lab and people         (lab/group, current students and postdocs if listed, collaborators, funding or grants, open projects)
## Teaching               (courses they teach or have taught at this university)
## Supervision            (what they say about taking master's students, how to apply to them, funding, any instructions for prospective students)
## Fit with you           (specific overlaps and gaps between their work and the applicant's background)
## How to approach        (what to read first, talking points, questions worth asking, things to avoid)"""


def faculty_deep_dive(item: dict, person: dict) -> tuple[dict, dict]:
    usage = Usage()
    known = {k: person[k] for k in ("name", "title", "department", "research", "url") if person.get(k)}
    prompt = (
        f"{_context(full=True)}\n\n<program>\n{_item_brief(item, 'faculty')}\n</program>\n\n"
        f"<person>\n{yaml.safe_dump(known, sort_keys=False, allow_unicode=True, width=200)}</person>\n\n"
        "Write the in-depth profile of this person for the applicant."
    )
    _report(f"Looking into {person['name']} in depth")
    result = _structured(
        usage, FACULTY_DEEP_SYSTEM, prompt, FACULTY_DEEP_SCHEMA, web=True, budget=(6, 12), effort="high",
        tool_name="submit_profile", tool_desc="Submit the in-depth profile of this person.",
    )
    return result, usage.to_dict()


# ---------------------------------------------------------------- funding

FUNDING_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["summary", "guaranteed", "typical_package", "typical_package_usd_per_year", "assistantships", "awards", "external", "notes", "sources"],
    "properties": {
        "summary": {"type": "string", "description": "Two or three plain sentences: how master's students in this program are usually funded and what that means for this applicant"},
        "guaranteed": {"type": "string", "enum": ["yes", "partial", "no", "unknown"], "description": "Whether admitted students get a guaranteed funding package"},
        "typical_package": {"type": "string", "description": "What a typical funded student receives, as published (amount, currency, period, what it's made of), else empty"},
        "typical_package_usd_per_year": {"type": ["number", "null"], "description": "That package converted to approximate USD per year, null if unknown"},
        "assistantships": {"type": "string", "description": "Teaching/research assistantships: availability, hours, pay, how they're assigned"},
        "awards": {
            "type": "array",
            "description": "Internal awards, scholarships and fee waivers open to international master's students in this program or faculty",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["name", "amount", "amount_usd_per_year", "eligibility", "how", "deadline", "url"],
                "properties": {
                    "name": {"type": "string"},
                    "amount": {"type": "string", "description": "As published, e.g. 'CAD 2,500 per term for up to 5 terms'"},
                    "amount_usd_per_year": {"type": ["number", "null"], "description": "Approximate USD per year, null if unknown"},
                    "eligibility": {"type": "string", "description": "Who qualifies, one or two sentences; flag if this applicant does not qualify"},
                    "how": {"type": "string", "enum": ["automatic", "nomination", "application"], "description": "Automatic consideration at admission, nomination by the department, or a separate application"},
                    "deadline": {"type": "string", "description": "Deadline if a separate step is needed, else empty"},
                    "url": {"type": "string"},
                },
            },
        },
        "external": {
            "type": "array",
            "description": "External scholarships commonly held by international students in this program or country that this applicant could apply to",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["name", "provider", "amount", "eligibility", "url"],
                "properties": {"name": _STR, "provider": _STR, "amount": _STR, "eligibility": _STR, "url": _STR},
            },
        },
        "notes": {"type": "string", "description": "Caveats: funding tied to a supervisor, renewal conditions, work-permit limits on hours, etc."},
        "sources": _STRS,
    },
}

FUNDING_SYSTEM = """You research how one graduate program is funded, for one international applicant.
Use official university, faculty and department pages first; then reputable funders' pages for external awards.
List every internal award, fee waiver and assistantship that international master's students in this program can get,
say how each is obtained (automatic / nomination / separate application), and flag anything this applicant is not
eligible for (e.g. domestic-only awards). Never invent amounts; leave them empty when unpublished.
The program, graduate-studies and faculty funding pages usually suffice."""


def funding(item: dict) -> tuple[dict, dict]:
    usage = Usage()
    prompt = (
        f"{_context()}\n\n<program>\n{_item_brief(item, 'funding')}\n</program>\n\n"
        f"Research the full funding picture for this program and this applicant. Today is {date.today().isoformat()}."
    )
    result = _structured(
        usage, FUNDING_SYSTEM, prompt, FUNDING_SCHEMA, web=True,
        tool_name="submit_funding", tool_desc="Submit the funding research.",
    )
    return result, usage.to_dict()


# ---------------------------------------------------------------- ask: one targeted request

# Fields an "ask" may change, with the shape the model must return (as JSON in value_json).
# Anything not listed here (notes, scores, faculty profiles, funding research, stage) is never touched by an ask;
# faculty_extra_urls only hands new pages to the faculty agent.
ASK_FIELDS: dict[str, str] = {
    "deadlines": "list of {label: string, date: 'YYYY-MM-DD'}",
    "requirements": "list of strings",
    "checklist": "list of {item: string, done: boolean}",
    "expenses": "list of {label: string, amount: number|null, currency: 'USD'|'CAD'|..., paid: boolean, date: 'YYYY-MM-DD'|null}",
    "admission": "object {gpa, english, gre, background: string; prerequisites: string[]; documents: string[]; letters, notes: string}",
    "portal": "object {url: string, username: string}",
    "tuition": "string, as published",
    "tuition_usd_per_year": "number|null",
    "living_usd_per_year": "number|null",
    "funding": "string",
    "overview": "string",
    "format": "string",
    "duration": "string",
    "structure": "string",
    "courses": "list of strings",
    "sop_prompt": "string, the essay prompt and limits",
    "intake": "string",
    "degree": "string",
    "city": "string",
    "url": "string, official page",
    "outcomes": "string",
    "coverage": "string (scholarships)",
    "eligibility": "list of strings (scholarships)",
    "selection": "list of strings (scholarships)",
    "awards_per_year": "string (scholarships)",
    "provider": "string (scholarships)",
    "essays": "list of {id: string, type: 'sop'|'soi'|'personal'|'research'|'other', title: string, prompt: string (the exact wording), "
              "limit: number|null (words)}: every written statement the application requires. Keep existing ids; new ones get a short "
              "lowercase id like 'diversity'",
    "faculty_extra_urls": "list of URLs (programs): extra faculty, department contacts or lab pages whose people get added to the "
                          "faculty list as possible supervisors not on the official supervisors list. Add a page here when asked to add "
                          "people from it; a separate agent copies the names and marks who isn't officially listed. Never edit "
                          "faculty_profiles yourself",
}

ASK_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["answer", "changes", "sources"],
    "properties": {
        "answer": {"type": "string", "description": "Short markdown reply: what you found, what you changed, what you could not confirm."},
        "changes": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["field", "value_json", "why"],
                "properties": {
                    "field": {"type": "string", "enum": list(ASK_FIELDS)},
                    "value_json": {"type": "string", "description": "The field's complete new value, JSON-encoded."},
                    "why": {"type": "string"},
                },
            },
        },
        "sources": _STRS,
    },
}

ASK_SYSTEM = """You handle one specific request about one program or scholarship an applicant is tracking.
Do only what the request asks. Search the web only as much as the request needs, and confirm facts on official pages.
Change a field only when the request calls for it and you confirmed the new value. For list and object fields, return the
complete new value: keep every existing entry exactly as it is and add or edit only what the request is about. Never remove
entries unless the request says to. Dates are YYYY-MM-DD for the upcoming cycle; if only last cycle's date is published,
use it and say so in the label. Label a program's application fee exactly "Application fee" (details go in the answer).
If the request is just a question, answer it and make no changes.
Leave out anything you cannot confirm, and say so in the answer. Keep the answer short and plain."""


def ask(item: dict, request: str) -> tuple[dict, dict]:
    usage = Usage()
    current = {k: item[k] for k in ASK_FIELDS if item.get(k) not in (None, "", [], {})}
    if item.get("kind") == "program" and "essays" not in current:
        current["essays"] = store.essays_for(item)  # the derived default, so its id ("sop") is kept
    fields = "\n".join(f"- {k}: {v}" for k, v in ASK_FIELDS.items())
    # The faculty list itself is read-only here; names only, so the request can refer to it.
    people = item.get("faculty_profiles") or []
    faculty = (
        f"<faculty_list source=\"{item.get('faculty_source_url') or ''}\">\n"
        + "\n".join(f"- {f['name']}{' (not on the official list)' if f.get('listed') is False else ''}" for f in people)
        + "\n</faculty_list>\n\n"
    ) if people else ""
    prompt = (
        f"{_context()}\n\n<entry>\n{_item_brief(item, 'research')}\n</entry>\n\n{faculty}"
        f"<current_fields>\n{yaml.safe_dump(current, sort_keys=False, allow_unicode=True, width=200)}\n</current_fields>\n\n"
        f"<fields_you_may_change>\n{fields}\n</fields_you_may_change>\n\n"
        f"<request>\n{request}\n</request>\n\nToday is {date.today().isoformat()}."
    )
    result = _structured(
        usage, ASK_SYSTEM, prompt, ASK_SCHEMA, web=True, budget=(4, 8),
        tool_name="submit_answer", tool_desc="Submit the answer and any field changes.",
    )
    return result, usage.to_dict()


# ---------------------------------------------------------------- tests: keep the applicant's test list up to date

_TEST = {
    "type": "object",
    "additionalProperties": False,
    "required": ["name", "date", "total", "max", "sections", "expires", "file", "notes"],
    "properties": {
        "name": {"type": "string", "description": "Official test name, e.g. 'TOEFL iBT', 'IELTS Academic', 'GRE General'"},
        "date": {"type": "string", "description": "YYYY-MM-DD; the booked date for a planned test"},
        "total": {"type": ["number", "null"], "description": "Overall score; null for a booked test without results"},
        "max": {"type": ["number", "null"]},
        "sections": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["name", "score", "max"],
                "properties": {"name": _STR, "score": {"type": ["number", "null"]}, "max": {"type": ["number", "null"]}},
            },
        },
        "expires": {"type": ["string", "null"], "description": "YYYY-MM-DD the scores stop being valid"},
        "file": {"type": "string", "description": "Score report path like 'Test-Scores/IELTS-2026-03-01.pdf', or empty"},
        "notes": {"type": "string"},
    },
}

TESTS_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["answer", "tests"],
    "properties": {
        "answer": {"type": "string", "description": "One or two plain sentences: what you added or changed."},
        "tests": {"type": "array", "items": _TEST, "description": "The applicant's complete, updated list of tests."},
    },
}

TESTS_SYSTEM = """You keep one applicant's list of standardised tests (English tests, GRE, GMAT, SAT…) up to date.
You get their current list, any score reports found in their files, and a note from them. Return the complete updated list:
keep every existing test unless the note or a report changes it, add new ones, and fill in results when a report or the note gives them.
A booked or planned test has its date and total = null. Use each test's official maximums (TOEFL iBT 120 with four sections of 30,
IELTS 9 bands, GRE 340 with Verbal 170, Quant 170 and Analytical Writing 6, Duolingo 160, PTE 90). Set `expires` from the test
date using the official validity (TOEFL, IELTS, Duolingo, PTE: 2 years; GRE and GMAT: 5 years) unless a report states otherwise.
Link a test to its report file when one matches. Never invent scores: if something is missing, leave it null and say so."""


def tests_update(note: str, tests: list[dict], reports: list[dict]) -> tuple[dict, dict]:
    usage = Usage()
    report_text = "\n\n".join(f"<report file=\"{r['file']}\">\n{r['text']}\n</report>" for r in reports) or "(none)"
    prompt = (
        f"<current_tests>\n{yaml.safe_dump(tests, sort_keys=False, allow_unicode=True) if tests else '(none yet)'}\n</current_tests>\n\n"
        f"<score_reports>\n{report_text}\n</score_reports>\n\n"
        f"<note_from_applicant>\n{note or 'Read my score reports and update my tests.'}\n</note_from_applicant>\n\n"
        f"Today is {date.today().isoformat()}."
    )
    _report("Reading your tests and score reports")
    result = _structured(usage, TESTS_SYSTEM, prompt, TESTS_SCHEMA, web=False, effort="low")
    return result, usage.to_dict()


# ---------------------------------------------------------------- scoring

SCORE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["fit", "cost", "admit", "career", "tier", "rationale"],
    "properties": {
        "fit": {"type": "integer", "description": "0-10: how well the applicant's background and interests match the program"},
        "cost": {"type": "integer", "description": "0-10: affordability given funding and the applicant's budget (10 = fully funded/cheap)"},
        "admit": {"type": "integer", "description": "0-10: likelihood of admission (10 = very likely)"},
        "career": {"type": "integer", "description": "0-10: career outcomes, location, post-study work rights, reputation"},
        "tier": {"type": "string", "enum": ["reach", "target", "safety"]},
        "rationale": {"type": "string", "description": "Markdown, 4-8 bullets covering each score"},
    },
}

SCORE_SYSTEM = """You are a frank graduate admissions advisor. Score one program for one applicant.
Be calibrated: most programs should not score 8+ on everything, and highly selective programs are reaches
even for strong applicants. Base the cost score on the applicant's stated budget and funding need."""


def score(item: dict) -> tuple[dict, dict]:
    usage = Usage(MODEL_LIGHT)
    prompt = f"{_context(full=True)}\n\n<program>\n{_item_brief(item, 'score')}\n</program>\n\nScore this program for the applicant."
    result = _structured(usage, SCORE_SYSTEM, prompt, SCORE_SCHEMA, web=False, effort="high")
    result["scored_on"] = date.today().isoformat()
    return result, usage.to_dict()


# ---------------------------------------------------------------- coursework vs requirements

COURSE_CHECK_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["verdict", "summary", "requirements", "gaps", "actions", "sources"],
    "properties": {
        "verdict": {"type": "string", "enum": ["eligible", "likely", "at risk", "not eligible", "unclear"],
                    "description": "Overall: does the applicant meet the academic entry requirements?"},
        "summary": {"type": "string", "description": "Markdown, 2-4 bullets: the verdict and what decides it"},
        "requirements": {
            "type": "array",
            "description": "Every academic entry requirement the official pages state, one per item",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["requirement", "status", "evidence", "ects", "note", "source"],
                "properties": {
                    "requirement": {"type": "string", "description": "The requirement as the official page states it, closely paraphrased, with the number if it has one"},
                    "status": {"type": "string", "enum": ["met", "partial", "missing", "unclear"]},
                    "evidence": {"type": "array", "items": {"type": "string"},
                                 "description": "Course codes (exactly as in <courses>) or test names that satisfy it"},
                    "ects": {"type": ["number", "null"], "description": "ECTS the evidence adds up to, when the requirement is in credits"},
                    "note": {"type": "string", "description": "One or two sentences: why this status, which topics match or are missing"},
                    "source": {"type": "string", "description": "URL of the official page or statute stating it"},
                },
            },
        },
        "gaps": {"type": "array", "items": {"type": "string"}, "description": "What is missing or unproven, most serious first"},
        "actions": {"type": "array", "items": {"type": "string"}, "description": "Concrete next steps (ask the office, add an outline, take a course)"},
        "sources": {"type": "array", "items": {"type": "string"}, "description": "Official URLs read"},
    },
}

COURSE_CHECK_SYSTEM = """You check whether an applicant's completed university coursework meets one graduate program's academic
entry requirements, so the applicant can be sure before applying.

First find the official requirement text: the program's admission page and, where they exist, the admission or aptitude
statutes and regulations (for example a German FPSO or Eignungsverfahren appendix), required-module or curriculum-analysis
tables, prerequisite lists, minimum credits per subject area and the accepted degree types. Prefer the newest official
version. State each requirement as the source does, with its numbers, and cite the URL.

Then compare each requirement with <courses>, judging by the listed topics and outcomes, not titles alone. When a
requirement is in credits, add up the ECTS given for the courses you count, and count each course toward only one
requirement group. Also check degree-type eligibility, any minimum grade and any required tests against the profile.

Be strict and honest: "met" only when the evidence clearly covers it, "partial" when it covers part, "missing" when nothing
does, "unclear" when the official text is vague or you could not find it. Never invent a requirement or a course.
Courses without topics have no outline: say so when that matters."""


def courses_brief(data: dict) -> str:
    """The applicant's courses for a prompt: one block per course with its key facts and topics."""
    out = []
    for c in data.get("courses") or []:
        facts = "; ".join(f"{f['label']}: {f['value']}" for f in c.get("facts") or [] if f["label"].lower() not in ("outline",))
        lines = [f"{c['code']}: {c['title']} ({c.get('department', '')}). {facts}"]
        if c.get("topics"):
            lines += [f"  - {t}" for t in c["topics"]]
        elif c.get("note"):
            lines.append(f"  ({c['note']})")
        out.append("\n".join(lines))
    return "\n".join(out)


def course_check(item: dict, courses: dict) -> tuple[dict, dict]:
    usage = Usage(MODEL)
    brief = _item_brief(item, "course_check")
    prompt = (f"{_context()}\n\n<courses>\n{courses.get('intro', '')}\n{courses_brief(courses)}\n</courses>\n\n"
              f"<program>\n{brief}\n</program>\n\nCheck this applicant's coursework against the program's official requirements.")
    _report("Reading the official requirements")
    result = _structured(usage, COURSE_CHECK_SYSTEM, prompt, COURSE_CHECK_SCHEMA, web=True, tool_name="submit_course_check",
                         tool_desc="Submit the requirement-by-requirement check", effort="high")
    result["checked_on"] = date.today().isoformat()
    return result, usage.to_dict()


# ---------------------------------------------------------------- entry-requirements checklist

REQ_SOURCES_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["documents"],
    "properties": {
        "documents": {
            "type": "array",
            "description": "Official documents to read, most important first",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["url", "title", "why"],
                "properties": {
                    "url": {"type": "string", "description": "Direct URL; for a statute or annex, the PDF itself"},
                    "title": {"type": "string", "description": "What the document is, e.g. 'Admission statute (FPSO), Annex 2'"},
                    "why": {"type": "string", "description": "Which requirements it holds"},
                },
            },
        },
    },
}

REQ_SOURCES_SYSTEM = """You find the official documents that state one graduate program's complete entry requirements, so the app
can download and read them in full. You don't extract the requirements yourself.

List every official page or file that sets a condition for admission, in this order of importance:
1. The program's own admission / entry-requirements page (and its "how to apply" or "application documents" page).
2. The legally binding rules: admission or aptitude statutes and their annexes (in Germany the Fachprüfungs- und
   Studienordnung / FPSO, Satzung über die Eignungsfeststellung, Zulassungssatzung, Anlage 1/2/3), Dutch admission
   requirement pages and Teaching and Examination Regulations (OER/TER) admission articles, Swedish "specific entry
   requirements" and the university's local admission rules. Give the PDF itself, not a page that links to it.
3. Required forms or tables: curriculum-analysis sheets, module or prerequisite lists, self-assessment forms, credit
   calculators.
4. The university's general rules that apply to this program: language requirements (with minimum scores), document
   rules for degrees from the applicant's country, uni-assist / VPD or universityadmissions.se / Studielink steps,
   application fee rules.
Use the newest version of each statute (check its date). Include the German original when no English version exists.
Prefer URLs from <known_links>, which the app found on the official pages; search only for what is missing.
Return at most 14 documents."""

_REQ_QUOTE = {
    "type": "object",
    "additionalProperties": False,
    "required": ["text", "translation", "source", "location"],
    "properties": {
        "text": {"type": "string", "description": "The exact words copied from the document, in its language, complete (whole sentences or the whole list item, all numbers kept). Use … only to skip text that sits between two parts of one requirement."},
        "translation": {"type": "string", "description": "Faithful English translation when the text is not in English, else empty"},
        "source": {"type": "integer", "description": "Number n of the document in <documents> it was copied from"},
        "location": {"type": "string", "description": "Where in it: section/§/article/annex number and heading, page, table row"},
    },
}

_REQ_STATUSES = ["met", "likely", "maybe", "not met", "unclear", "to do", "not applicable"]

REQ_CHECKLIST_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["verdict", "summary", "items", "unresolved", "questions", "need_documents"],
    "properties": {
        "verdict": {"type": "string", "enum": ["eligible", "likely", "at risk", "not eligible", "unclear"],
                    "description": "Overall: can the applicant meet every pass/fail entry requirement?"},
        "summary": {"type": "string", "description": "Markdown, 3-6 bullets: the verdict, the requirements that decide it, and the biggest risks, with numbers"},
        "items": {
            "type": "array",
            "description": "One item per distinct requirement, covering every requirement in the documents",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["key", "group", "title", "kind", "applies_if", "applies_to_you", "quotes", "parts", "status",
                             "assessment", "evidence", "ects_required", "ects_counted", "how", "deadline"],
                "properties": {
                    "key": {"type": "string", "description": "Short stable kebab-case id, e.g. 'math-ects-30'. Reuse the key from <previous_keys> for the same requirement."},
                    "group": {"type": "string", "enum": ["degree", "subject-credits", "courses", "grades", "language", "tests", "documents",
                                                          "application", "selection", "deadlines", "other"]},
                    "title": {"type": "string", "description": "The requirement in a few words with its numbers, e.g. 'At least 30 ECTS in mathematics, 8 of them statistics'"},
                    "kind": {"type": "string", "enum": ["must", "conditional", "scored", "document", "step"],
                             "description": "must = pass/fail condition; conditional = only for some applicants; scored = counts in selection points; document = something to submit; step = a procedure to follow"},
                    "applies_if": {"type": "string", "description": "For conditional items, who it applies to, as the source says; else empty"},
                    "applies_to_you": {"type": "string", "enum": ["yes", "no", "unclear"]},
                    "quotes": {"type": "array", "items": _REQ_QUOTE, "description": "Every passage that states this requirement, verbatim"},
                    "parts": {
                        "type": "array",
                        "description": "When a requirement has several thresholds (credit areas, listed modules, sub-scores), one row each, so each can be ticked",
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": ["label", "required", "have", "status", "evidence"],
                            "properties": {
                                "label": {"type": "string", "description": "e.g. 'Statistics', 'Linear Algebra II', 'IELTS writing'"},
                                "required": {"type": "string", "description": "The threshold, e.g. '≥ 8 ECTS', 'band 6.5'"},
                                "have": {"type": "string", "description": "What the applicant has, e.g. '11 ECTS (MATH 230, ECON 330)', or 'nothing yet'"},
                                "status": {"type": "string", "enum": _REQ_STATUSES},
                                "evidence": {"type": "array", "items": {"type": "string"}, "description": "Course codes exactly as in <courses>, or test/document names"},
                            },
                        },
                    },
                    "status": {"type": "string", "enum": _REQ_STATUSES,
                               "description": "met = clearly satisfied now; likely = should be, the committee decides; maybe = could go either way; not met = not satisfied now; unclear = the rule is vague or its text was not available; to do = something the applicant must still produce or do and can; not applicable = does not apply to this applicant"},
                    "assessment": {"type": "string", "description": "2-4 sentences: exactly why this status, citing courses with their ECTS and topics, test scores, or what is missing"},
                    "evidence": {"type": "array", "items": {"type": "string"}, "description": "Course codes exactly as in <courses>, test names, or documents that satisfy it"},
                    "ects_required": {"type": ["number", "null"]},
                    "ects_counted": {"type": ["number", "null"], "description": "Sum of the ECTS of the evidence courses when the requirement is in credits"},
                    "how": {"type": "array", "items": {"type": "string"},
                            "description": "Concrete steps to satisfy or prove it, in order: what to get, from whom, in what form (certified copy, translation, official score report to code X), what to write, whom to email and what to ask. Empty only when met and nothing needs submitting."},
                    "deadline": {"type": "string", "description": "When it must be done, if the documents say; else empty"},
                },
            },
        },
        "unresolved": {"type": "array", "items": {"type": "string"},
                       "description": "Requirements referred to but not readable in the documents (a missing annex, a page that failed), and any rule you could not pin down"},
        "questions": {"type": "array", "items": {"type": "string"}, "description": "Precise questions to send the admissions office"},
        "need_documents": {
            "type": "array",
            "description": "Official documents the given ones refer to that hold requirements but were not provided (e.g. 'Annex 2 of the FPSO'); give URLs only if they appear in the documents' links or you are sure of them",
            "items": {"type": "object", "additionalProperties": False, "required": ["url", "title"],
                      "properties": {"url": {"type": "string"}, "title": {"type": "string"}}},
        },
    },
}

REQ_CHECKLIST_SYSTEM = """You turn one graduate program's official entry requirements into a complete checklist for one applicant,
so the applicant knows exactly what they must meet, what they must submit, and how. Nothing may be missing or compressed.

You get the full text of the official documents in <documents>, numbered. Work only from them.

Completeness:
- Read every document from start to end. Every sentence that sets a condition on who is admitted, what must be submitted, in what
  form, how, by when, or how applicants are scored belongs to an item. When unsure whether something is a requirement, include it.
- One item per distinct requirement. Never merge separate requirements. A sentence with two conditions gives two items, or one item
  with two parts.
- When a requirement is a list (subject areas with credit minimums, required modules, sub-scores, document list), give every entry
  as a part, with its own threshold. "60 ECTS in mathematics and statistics, of which at least 15 in statistics" has parts.
- Include conditional rules even when they likely don't apply (degrees from certain countries, three-year bachelors, German-taught
  routes), set applies_to_you, and check the applicant's own case (country of degree, degree length, language of instruction).
- Include the selection procedure in full: criteria, weights, points, thresholds, interviews.
- Include formal steps: portal, uni-assist / VPD, certified copies, translations, fees, document formats, deadlines.
- Statutes refer to annexes and other rules. If an annex that holds requirements is not in <documents>, list it in need_documents
  and unresolved, and say in the item that its text was not available.

Quotes:
- quotes[].text is copied exactly, character for character, from the numbered document, in its language, with all numbers. The app
  checks every quote against the document text, so never paraphrase, fix or shorten inside a quote. Translate in `translation`.
- Cite the section, paragraph, annex or page in `location`.

Checking the applicant:
- Compare with <courses> by topics and learning outcomes, not titles alone. Credits in <courses> are ECTS where given; otherwise
  convert as <courses> explains. Count each course toward one subject area only, and show the sum.
- Use the profile and test scores for degree, grades (convert as the documents say, e.g. the modified Bavarian formula), language
  and tests. Note test validity against the deadline.
- Be strict and honest. "met" only when the evidence clearly covers it. "maybe" is fine and wanted where it could go either way:
  say what it depends on.
- For every item that is not plainly met with nothing left to do, give `how`: concrete steps to satisfy or prove it.

Never invent a requirement, a number, a course or a URL."""


def requirements_sources(item: dict, known_links: list[str]) -> tuple[list[dict], dict]:
    usage = Usage(MODEL)
    brief = _item_brief(item, "course_check")
    links = "\n".join(known_links[:60])
    prompt = (f"{_context()}\n\n<program>\n{brief}\n</program>\n\n<known_links>\n{links}\n</known_links>\n\n"
              "List the official documents that state this program's complete entry requirements.")
    _report("Finding the official requirement documents")
    result = _structured(usage, REQ_SOURCES_SYSTEM, prompt, REQ_SOURCES_SCHEMA, web=True, tool_name="submit_documents",
                         tool_desc="Submit the documents to read", effort="medium", budget=(5, 6))
    return result.get("documents") or [], usage.to_dict()


def requirements_checklist(item: dict, docs: list[dict], courses: dict, previous_keys: list[str], usage: Usage | None = None,
                           existing: list[dict] | None = None) -> dict:
    """One extraction pass over the documents the app read. `docs`: [{n, url, title, text}].
    With `existing` (a draft checklist), only the new documents are read and only new or changed items come back."""
    usage = usage or Usage(MODEL)
    brief = _item_brief(item, "course_check")
    blocks = []
    for d in docs:
        attrs = f'n="{d["n"]}" url="{d["url"]}" title="{(d.get("title") or "").replace(chr(34), "")}"'
        links = d.get("pdf_links") or []
        link_note = ("\nLinks on this page to further rules:\n" + "\n".join(links)) if links else ""
        blocks.append(f"<document {attrs}>\n{d['text']}{link_note}\n</document>")
    prompt = (f"{_context()}\n\n<courses>\n{courses.get('intro', '')}\n{courses_brief(courses)}\n</courses>\n\n"
              f"<program>\n{brief}\n</program>\n\n<documents>\n" + "\n\n".join(blocks) + "\n</documents>\n\n"
              f"<previous_keys>\n{', '.join(previous_keys) or '(none)'}\n</previous_keys>\n\n")
    if existing is None:
        prompt += "Build the complete entry-requirements checklist for this applicant."
    else:
        prompt += (f"<draft_checklist>\n{json.dumps(existing, ensure_ascii=False)}\n</draft_checklist>\n\n"
                   "The draft checklist was built from earlier documents, which referred to the documents above. Read these new "
                   "documents completely. In `items` return ONLY items that are new, or draft items that change because of them "
                   "(return the whole item with the same key; it replaces the draft one, so keep its existing quotes and their "
                   "source numbers). Return verdict, summary, unresolved and questions in full, updated for everything. "
                   "need_documents may be empty.")
    _report(f"Reading {len(docs)} {'more ' if existing is not None else ''}official documents line by line")
    return _structured(usage, REQ_CHECKLIST_SYSTEM, prompt, REQ_CHECKLIST_SCHEMA, web=False, effort="high", max_tokens=64000)


# ---------------------------------------------------------------- per-program resume

RESUME_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["sections", "cut_order", "rationale"],
    "properties": {
        "sections": {
            "type": "array",
            "description": "Sections to keep, in the order they should appear. Leave a section out to remove it.",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "entries"],
                "properties": {
                    "id": {"type": "string", "description": "Section id"},
                    "entries": {"type": "array", "items": {"type": "string"},
                                "description": "Entry ids of this section to keep, in order. Empty for sections without entries."},
                },
            },
        },
        "cut_order": {"type": "array", "items": {"type": "string"},
                      "description": "Kept entry ids that may still be cut if the PDF runs over the page limit, least important first"},
        "rationale": {"type": "string", "description": "Markdown, 3-6 bullets: what leads, what was cut and why"},
    },
}

RESUME_SYSTEM = """You tailor an applicant's academic resume to one graduate program by choosing which entries to keep and in
what order. You cannot edit, shorten or rewrite any text: you only select and order whole entries and sections, by id.
Lead with what this program's admissions committee weighs most (research for research-based or thesis programs; relevant
technical work for course-based or professional ones). Within a section, put the most relevant entries first. Cut entries
that add little for this program, and remove whole sections only when they are clearly irrelevant. Always keep Education."""


def resume_plan(item: dict, doc: dict, max_pages: int, master_pages: int) -> tuple[dict, dict]:
    usage = Usage(MODEL)
    blocks = []
    for s in doc["sections"]:
        if s["id"] == "Header":
            continue  # name and contact details: always kept, never sent
        if s["entries"]:
            body = "\n\n".join(f"[{e['id']}]\n{_latex_to_text(e['tex'])}" for e in s["entries"])
        else:
            body = "(one block, no separate entries)\n" + _latex_to_text(s["text"])
        blocks.append(f'<section id="{s["id"]}" title="{s["title"]}">\n{body}\n</section>')
    prompt = (
        f"{_context()}\n\n<program>\n{_item_brief(item, 'resume')}\n</program>\n\n<master_resume>\n" + "\n\n".join(blocks) +
        f"\n</master_resume>\n\nThe master resume is {master_pages} pages. Choose the entries for a version of at most "
        f"{max_pages} pages tailored to this program, about {round(100 * max_pages / master_pages)}% of the master's length. "
        "Then rank the kept entries that could still go in cut_order, so it can be trimmed further if the PDF runs long."
    )
    _report("Choosing entries for this program")
    return _structured(usage, RESUME_SYSTEM, prompt, RESUME_SCHEMA, web=False, effort="medium"), usage.to_dict()


RESUME_EDIT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["changes", "note"],
    "properties": {
        "changes": {
            "type": "array",
            "description": "Only the chunks you changed. Leave everything else out.",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "tex", "summary"],
                "properties": {
                    "id": {"type": "string", "description": "The chunk id, exactly as given"},
                    "tex": {"type": "string", "description": "The whole chunk's new LaTeX, same structure and macros as before"},
                    "summary": {"type": "string", "description": "One short line: what you changed"},
                },
            },
        },
        "note": {"type": "string", "description": "One or two sentences for the applicant: what you did, or why you left something alone"},
    },
}

RESUME_EDIT_SYSTEM = """You edit an applicant's resume for one graduate program. You get the LaTeX chunks currently in that
program's resume (one per entry, or one per block section such as skills) and one instruction, like "shorten my TA roles to two
bullets each" or "expand the Zambeel project". Change only what the instruction asks, and only the chunks it is about.

Rules:
- Never invent anything: no new facts, numbers, tools, results, roles, dates or claims. Shortening means cutting and condensing.
  Expanding may only use details already in the master resume or profile you're given; if there isn't more to say, change
  nothing and explain in the note.
- Keep every claim exactly as true as it was. When you merge or condense, never let a verb or a number spread to things it
  didn't cover: "designed the CNN assignments and graded the GAN ones" must not become "designed CNN and GAN assignments";
  "assisted", "graded" or "contributed to" never become "led", "designed" or "built". If two claims can't be merged without
  changing what you did, cut the less important one instead.
- In the note, say plainly what was cut or merged; don't claim nothing changed.
- Keep each chunk's structure: the same \\resumeSubheading{..}{..}{..}{..} or \\resumeProjectHeading{..}{..} line (its text may
  be tightened), \\resumeItemListStart / \\resumeItemListEnd around \\resumeItemLabel{..} bullets, and a block section's
  \\section{..} heading unchanged. Use only the macros already in the chunk.
- Escape LaTeX special characters (& % $ # _) and keep -- for ranges, as the original does.
- Return the whole chunk for each one you change, and nothing for the rest."""


RESUME_CHECK_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["claims"],
    "properties": {
        "claims": {
            "type": "array",
            "description": "Every atomic claim in every edited chunk",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "claim", "support", "supported"],
                "properties": {
                    "id": {"type": "string", "description": "The chunk id"},
                    "claim": {"type": "string", "description": "One verb with one object, e.g. 'designed the GAN assignment'"},
                    "support": {"type": "string", "description": "The exact words from the original that state this, or empty"},
                    "supported": {"type": "boolean", "description": "True only if `support` states this same verb for this same thing"},
                },
            },
        },
    },
}

RESUME_CHECK_SYSTEM = """You check edits to a resume for accuracy. Split each edited chunk into atomic claims, one verb with one
object each: "designed assignments covering CNNs and GANs" is two claims, "designed the CNN assignment" and "designed the GAN
assignment". For each claim, quote the exact words in the original that state it. A claim is supported only if the original
uses that verb (or a plain synonym, never a stronger one) for that same object. "Designed the CNN assignments, and graded the
GAN ones" does not support "designed the GAN assignment". Numbers, tools, dates and roles must match exactly."""


def _resume_edit_call(usage: Usage, item: dict, chunks: list[dict], instruction: str, focus: str | None, feedback: str = "") -> dict:
    blocks = "\n\n".join(f'<chunk id="{c["id"]}" title="{c["title"]}">\n{c["tex"].strip()}\n</chunk>' for c in chunks)
    target = next((c for c in chunks if c["id"] == focus), None)
    prompt = (
        f"{_context(full=True)}\n\n<program>\n{_item_brief(item, 'resume')}\n</program>\n\n<program_resume>\n{blocks}\n</program_resume>\n\n"
        + (f'The applicant is asking about the chunk "{target["title"]}" (id {target["id"]}).\n' if target else "")
        + f"Instruction: {instruction}"
        + (f"\n\nYour last attempt overstated things. Fix these, keeping each claim exactly as true as the original:\n{feedback}" if feedback else "")
    )
    return _structured(usage, RESUME_EDIT_SYSTEM, prompt, RESUME_EDIT_SCHEMA, web=False, effort="medium")


def _resume_edit_problems(usage: Usage, by_id: dict[str, dict], changes: list[dict]) -> list[dict]:
    pairs = "\n\n".join(
        f'<chunk id="{c["id"]}">\n<original>\n{_latex_to_text(by_id[c["id"]]["tex"])}\n</original>\n<edited>\n{_latex_to_text(c["tex"])}\n</edited>\n</chunk>'
        for c in changes
    )
    # The check runs on the stronger model: it's small, and a missed overstatement ends up on an application.
    strong = Usage(MODEL_STRONG)
    claims = _structured(strong, RESUME_CHECK_SYSTEM, pairs, RESUME_CHECK_SCHEMA, web=False, effort="high").get("claims") or []
    for k in ("input", "output", "cache_read", "cache_write"):
        setattr(usage, k, getattr(usage, k) + getattr(strong, k))
    bad: dict[str, list[str]] = {}
    for c in claims:
        if not c.get("supported"):
            bad.setdefault(c.get("id", ""), []).append(c.get("claim", ""))
    return [{"id": k, "why": "; ".join(v)} for k, v in bad.items()]


def resume_edit(item: dict, chunks: list[dict], instruction: str, focus: str | None) -> tuple[dict, dict]:
    """Edit chunks of one program's resume, then have a second pass check every edit against the original. One retry with
    the problems found; whatever still overstates is dropped (returned in `dropped`), never kept."""
    usage = Usage(MODEL)
    by_id = {c["id"]: c for c in chunks}
    _report("Editing the resume")
    out = _resume_edit_call(usage, item, chunks, instruction, focus)
    problems: list[dict] = []
    for attempt in range(2):
        changes = [{**c, "tex": re.sub(r"</?chunk[^>]*>", "", c.get("tex") or "")} for c in out.get("changes") or [] if c.get("id") in by_id]
        if not changes:
            return {"changes": [], "note": out.get("note") or "", "dropped": []}, usage.to_dict()
        _report("Checking the edit against your original")
        problems = [p for p in _resume_edit_problems(usage, by_id, changes) if p.get("id") in by_id]
        if not problems:
            return {"changes": changes, "note": out.get("note") or "", "dropped": []}, usage.to_dict()
        if attempt == 0:
            _report("Fixing what it overstated")
            out = _resume_edit_call(usage, item, chunks, instruction, focus, "\n".join(f"- {by_id[p['id']]['title']}: {p['why']}" for p in problems))
    bad = {p["id"] for p in problems}
    return {
        "changes": [c for c in changes if c["id"] not in bad],
        "note": out.get("note") or "",
        "dropped": [f"{by_id[p['id']]['title']}: left alone, the edit overstated it ({p['why']})" for p in problems],
    }, usage.to_dict()


LETTER_EMAIL_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["subject", "opening", "closing", "ps"],
    "properties": {
        "subject": {"type": "string"},
        "opening": {"type": "string", "description": "Greeting line, blank line, then one or two sentences: thanks for agreeing, and where the invitations will arrive"},
        "closing": {"type": "string", "description": "A one-line thank-you, blank line, sign-off word, newline, the applicant's full name"},
        "ps": {"type": "string", "description": "The P.S. text, without the 'P.S.' prefix"},
    },
}

LETTER_EMAIL_SYSTEM = """You write the words around a list in a short email from a graduate applicant to a recommender who has
already agreed to write for them. The app inserts the list of applications and deadlines itself, between your opening and
your closing, so never write the list, program names or dates. Warm, respectful and brief, in plain text (no markdown, no
links).

- opening: a greeting using their title and surname as in their notes ("Dear Dr. Smith,"), a blank line, then one or two
  sentences thanking them for agreeing to write and saying each program's portal will email them a reference invitation at
  the address given, written out in full, followed by something like "Here are the programs:".
- closing: a one-line thank-you, a blank line, then a sign-off ("Best regards,") and the applicant's full name on the next line.
- ps: one personal, specific request that fits this person: what they saw of the applicant first-hand (their courses, lab, TA
  work, as in their notes) and what these programs weigh. For example, a professor whose courses were mathematical could be
  asked to speak to the applicant's mathematical depth. Concrete and polite, two sentences at most.

Don't ask them to write the letter again, and don't offer documents unless their notes suggest they asked for some.
Describe your history with them in their notes' own words ("worked in your lab", not "you supervised me"; "took your course",
not "you mentored me"). Add no details about the process (no "once I submit", no "within a few weeks").
Never invent anything: no shared moments, grades, results or projects that aren't in their notes or the applicant's profile
and resume. Where their notes say TBD, don't fill it in. If there's nothing specific to ask, keep the P.S. short and general."""


def letter_list(letters: list[dict]) -> str:
    """The applications as numbered blocks, the same every time:

    1. MSc in Computer Science
       Example University
       Application deadline: 15 January 2027
       Recommender deadline: 1 January 2027
    """
    blocks = []
    for n, l in enumerate(letters, 1):
        pad = " " * (len(str(n)) + 2)
        lines = [f"{n}. {l['program']}", f"{pad}{l['university']}", f"{pad}Application deadline: {l['application_deadline']}"]
        if l.get("recommender_deadline"):
            lines.append(f"{pad}Recommender deadline: {l['recommender_deadline']}")
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks)


def letter_email(person: dict, letters: list[dict]) -> tuple[dict, dict]:
    """Claude writes the opening, closing and P.S.; the list itself is built here so it's always laid out the same way."""
    usage = Usage(MODEL)
    notes = re.sub(r"^.*\b(phone|mobile|whatsapp|address)\b.*$", "", person.get("body") or "", flags=re.I | re.M)  # contact details stay local
    listed = "\n".join(f"- {l['program']}, {l['university']}" for l in letters)
    prompt = (
        f"{_context(full=True)}\n\n<recommender>\nName: {person['name']}\nRole: {person.get('role', '')}\n"
        f"Invitations go to: {person.get('email') or 'their email (not on file yet)'}\n\n{notes}\n</recommender>\n\n"
        f"<applications_listed_by_the_app>\n{listed}\n</applications_listed_by_the_app>\n\nWrite the subject, opening, closing and P.S."
    )
    _report(f"Drafting the email to {person['name']}")
    out = _structured(usage, LETTER_EMAIL_SYSTEM, prompt, LETTER_EMAIL_SCHEMA, web=False, effort="medium")
    ps = (out.get("ps") or "").strip().removeprefix("P.S.").removeprefix("PS").strip(" :")
    body = "\n\n".join(x for x in [(out.get("opening") or "").strip(), letter_list(letters), (out.get("closing") or "").strip(), f"P.S. {ps}" if ps else ""] if x)
    return {"subject": (out.get("subject") or "").strip(), "body": body}, usage.to_dict()


# ---------------------------------------------------------------- SOP coach

COACH_SYSTEM = """You coach graduate application statements (statements of purpose, statements of interest, personal and
research statements, and scholarship essays). The applicant writes every sentence themselves.
Never write prose for them: no drafted paragraphs, no sample opening lines, no sentences they could paste.
You may give structure, questions to answer, which of their experiences to use and why, program-specific hooks
(faculty, labs, courses, themes) or, for a scholarship, the funder's mission and selection criteria to connect to,
and pointed critique. Quote their draft when critiquing it.
Format your answer in markdown with short headings."""


# What each kind of statement is for, so the coach judges it on the right terms.
ESSAY_GUIDE = {
    "sop": "A statement of purpose: the applicant's academic and professional path, what they want to study and why, their goals, "
           "and why this program in particular.",
    "soi": "A statement of interest: shorter and research-focused. It names the research areas the applicant wants to work in, the "
           "specific supervisors, labs or projects they fit, and the evidence they can do that research. Biography only where it "
           "proves research readiness.",
    "personal": "A personal statement: the person behind the application, their background, motivations and what shaped them, "
                "tied back to why they will thrive in the program.",
    "research": "A research statement: past research (question, method, result, the applicant's role), what they want to research "
                "next, and how this program's faculty and resources make that possible.",
    "other": "An application essay. Follow its prompt closely.",
    "supervisor": "A first (cold) email to a potential thesis supervisor, sent after applying. A busy professor decides in "
                  "seconds whether to read on, so judge it on: a specific subject line; who the applicant is in one line; a hook "
                  "that proves they read this person's recent work (a named paper or project and one concrete idea from it); "
                  "two or three pieces of evidence from the applicant's own background that connect to it; what they want to "
                  "work on, framed as interests they can grow with guidance rather than one narrow project; one real question; "
                  "a short close mentioning the attached CV. About 150-200 words. Flag generic praise, flattery, a life story, "
                  "claims the background doesn't support, asking about admission chances or funding up front, and anything "
                  "confidential from an employer.",
}


def _supervisor_brief(item: dict, essay: dict) -> str:
    """Who the email is to: their card, the deep dive on them, and the applicant's own notes on the contact."""
    name = essay.get("person", "")
    same = lambda x: (x.get("name") or "").lower() == name.lower()
    card = next((f for f in item.get("faculty_profiles") or [] if same(f)), {})
    contact = next((c for c in item.get("faculty") or [] if same(c)), {})
    parts = [f"<person>\n{yaml.safe_dump({k: card[k] for k in ('name', 'title', 'department', 'research', 'why', 'accepting', 'match', 'url') if card.get(k)} or {'name': name}, sort_keys=False, allow_unicode=True, width=200)}</person>"]
    deep = store.get_faculty_file(item["id"], name) if item.get("id") else {}
    if deep.get("text"):
        parts.append(f"<deep_dive>\n{deep['text'][:12000]}\n</deep_dive>")
    if (contact.get("notes") or "").strip():
        parts.append(f"<my_contact_notes>\n{contact['notes'].strip()[:6000]}\n</my_contact_notes>")
    return "\n\n".join(parts)


def _essay_brief(item: dict, essay: dict) -> str:
    kind = essay.get("type") or "sop"
    lines = [f"Statement: {essay.get('title') or kind}", ESSAY_GUIDE.get(kind, ESSAY_GUIDE["other"])]
    if item.get("kind") == "scholarship":
        lines.append("This essay is for a scholarship, not a program: judge it against the funder's purpose, eligibility and "
                     "selection criteria (leadership, impact, plans to contribute back), and read 'program' above as this scholarship.")
    if essay.get("prompt"):
        lines.append(f"Prompt: {essay['prompt']}")
    if essay.get("limit"):
        lines.append(f"Word limit: {essay['limit']}")
    if kind == "supervisor":
        lines.append(_supervisor_brief(item, essay))
    return "\n".join(lines)


def sop_outline(item: dict, essay: dict | None = None) -> tuple[str, dict]:
    usage = Usage(MODEL)
    essay = essay or {"type": "sop", "title": "Statement of purpose"}
    if essay.get("type") == "supervisor":
        prompt = (
            f"{_context(full=True)}\n\n<{item['kind']}>\n{_item_brief(item, 'sop')}\n</{item['kind']}>\n\n<statement>\n{_essay_brief(item, essay)}\n</statement>\n\n"
            f"Give me pointers for my first email to {essay.get('person', 'this person')}: what the subject line should "
            "signal, the parts in order with roughly how many words each, which of their papers or projects to hook on and "
            "why, the story of my interests that fits them (two or three threads, each backed by specific courses, projects "
            "or experience of mine) and what I could grow into with their guidance, the one question worth asking, and what "
            "to leave out. Build on my contact notes where they help, and say where you disagree with them."
        )
        return _complete(usage, COACH_SYSTEM, prompt), usage.to_dict()
    prompt = (
        f"{_context(full=True)}\n\n<{item['kind']}>\n{_item_brief(item, 'sop')}\n</{item['kind']}>\n\n<statement>\n{_essay_brief(item, essay)}\n</statement>\n\n"
        f"Give me a structure for this {essay.get('title', 'statement').lower()}: the sections in order, roughly how long "
        "each should be, what each must accomplish, which of my specific experiences belong where (and which to leave "
        f"out), details of this {item['kind']} I should connect to, and the questions I should answer for myself before writing. "
        f"Note any prompt or length requirements this {item['kind']} has if known."
    )
    return _complete(usage, COACH_SYSTEM, prompt), usage.to_dict()


def sop_review(item: dict, draft: str, essay: dict | None = None, comments: list[dict] | None = None) -> tuple[str, dict]:
    usage = Usage(MODEL)
    if not draft.strip():
        raise AIError("Write something first: the coach reviews your draft, it doesn't write it.")
    essay = essay or {"type": "sop", "title": "Statement of purpose"}
    # The applicant's own open notes on passages (resolved ones and ones whose passage is gone are left out).
    notes = [c for c in comments or [] if not c.get("resolved") and c.get("quote") and c.get("start") != c.get("end") and (c.get("text") or "").strip()]
    my_notes = "".join(f"<note passage={json.dumps(c['quote'][:300])}>\n{c['text'].strip()}\n</note>\n" for c in notes)
    prompt = (
        f"{_context()}\n\n<{item['kind']}>\n{_item_brief(item, 'sop')}\n</{item['kind']}>\n\n<statement>\n{_essay_brief(item, essay)}\n</statement>\n\n"
        f"<my_draft>\n{draft}\n</my_draft>\n\n"
        + (f"<my_notes>\n{my_notes}</my_notes>\n\n" if notes else "")
        + "Review my draft. Start with the two or three most important problems. Then go section by section: what works, "
        f"what's weak or generic, what's missing for this specific {item['kind']}, and what claims need evidence from my "
        "background. "
        + ("I've left my own notes on some passages (in my_notes): respond to each one under a heading \"Your notes\", "
           "quoting the passage briefly, saying whether you agree and what to do about it. "
           if notes else "")
        + "End with a short prioritized to-do list. Do not rewrite any of it for me."
    )
    return _complete(usage, COACH_SYSTEM, prompt), usage.to_dict()
