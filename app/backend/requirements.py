"""Entry-requirements checklist: the official texts, fetched and read by the app itself.

Claude's own web reading often can't open the documents that hold the real rules
(admission statutes, annexes, curriculum-analysis sheets), so this module downloads
them, turns HTML / PDF / XLSX into plain text, and keeps a copy beside the program:

    <program>/Requirements.md                 frontmatter = the checklist, body = readable version
    <program>/Requirements/Sources/NN-*.txt   the exact text each item was quoted from

Your own ticks, statuses and notes live in Requirements.md under `mine` (keyed by item
key) and survive every re-run. Every item's quote is checked against the saved source
text, so the page can show which quotes are verbatim.
"""

from __future__ import annotations

import html
import io
import re
import unicodedata
import urllib.request
import zipfile
from datetime import date
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlparse
from xml.etree import ElementTree

import store

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"
TIMEOUT_S = 60
MAX_BYTES = 25_000_000
MAX_DOC_CHARS = 90_000      # one statute is rarely longer; anything past this is cut and flagged
MAX_TOTAL_CHARS = 420_000   # all documents together in one prompt
MAX_DOCS = 16

# Link text / URL words that point at entry rules, in English, German, Dutch and Swedish.
LINK_WORDS = re.compile(
    r"admission|entry|requirement|eligib|prerequisite|apply|application|regulation|statute|ordinance|annex|appendix|attachment|"
    r"curricul|aptitude|selection|language|english|document|checklist|"
    r"zulassung|eignung|satzung|ordnung|fpso|anlage|bewerbung|voraussetzung|auswahl|studien.?und.?pr|"
    r"toelating|vooropleiding|eisen|behörighet|antagning|krav",
    re.I,
)
SKIP_LINK = re.compile(r"\.(jpe?g|png|gif|svg|webp|mp4|zip|ics)(\?|$)|mailto:|tel:|javascript:|facebook|twitter|linkedin|instagram|youtube", re.I)


class FetchError(Exception):
    pass


# ---------------------------------------------------------------- fetching

def _get(url: str) -> tuple[bytes, str, str]:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en,de;q=0.8,*;q=0.5"})
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
        return resp.read(MAX_BYTES + 1), (resp.headers.get("Content-Type") or "").lower(), resp.geturl()


def _other_host(url: str) -> str:
    """The same address on www.<host>, or without www. (certificates often cover only one of them)."""
    u = urlparse(url)
    host = u.netloc[4:] if u.netloc.startswith("www.") else "www." + u.netloc
    return u._replace(netloc=host).geturl()


def fetch(url: str) -> tuple[bytes, str, str]:
    """(body, content type, final url). Certificates are always verified. On a hostname mismatch it tries the
    www / non-www twin of the address; on a timeout or dropped connection it tries once more."""
    tries = [url, url]
    i = 0
    while True:
        try:
            body, ctype, final = _get(tries[i])
            break
        except Exception as e:  # noqa: BLE001 - any network failure is reported per document
            msg = str(e)
            retry = "Hostname mismatch" in msg or "timed out" in msg.lower() or isinstance(e, (TimeoutError, ConnectionError))
            if i >= len(tries) - 1 or not retry:
                raise FetchError(f"{type(e).__name__}: {msg[:160]}") from e
            if "Hostname mismatch" in msg:
                tries[i + 1] = _other_host(url)
            i += 1
    if len(body) > MAX_BYTES:
        raise FetchError("file is larger than 25 MB")
    return body, ctype, final


def _kind(url: str, ctype: str, body: bytes) -> str:
    path = urlparse(url).path.lower()
    if body[:5] == b"%PDF-" or "pdf" in ctype or path.endswith(".pdf"):
        return "pdf"
    if body[:2] == b"PK" and (path.endswith((".xlsx", ".xlsm")) or "spreadsheet" in ctype):
        return "xlsx"
    if body[:2] == b"PK" and (path.endswith(".docx") or "wordprocessing" in ctype):
        return "docx"
    return "html"


class _HTMLText(HTMLParser):
    """Visible text with block structure kept as line breaks, plus every link."""

    BLOCK = {"p", "div", "section", "article", "li", "ul", "ol", "tr", "table", "br", "h1", "h2", "h3", "h4", "h5", "h6",
             "dd", "dt", "dl", "blockquote", "summary", "details", "header", "footer", "td", "th"}
    SKIP = {"script", "style", "noscript", "svg", "template", "iframe"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.links: list[tuple[str, str]] = []
        self._skip = 0
        self._href: str | None = None
        self._link_text: list[str] = []
        self._nav = 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in self.SKIP:
            self._skip += 1
        if tag == "nav":  # only real <nav> elements: a role="navigation" div has no matching end tag to count
            self._nav += 1
        if tag in self.BLOCK:
            self.out.append("\n")
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self.out.append("#" * int(tag[1]) + " ")
        if tag == "li":
            self.out.append("- ")
        if tag in ("td", "th"):
            self.out.append(" | ")
        if tag == "a" and a.get("href"):
            self._href, self._link_text = a["href"], []

    def handle_endtag(self, tag):
        if tag in self.SKIP and self._skip:
            self._skip -= 1
        if tag == "nav" and self._nav:
            self._nav -= 1
        if tag == "a" and self._href:
            self.links.append((self._href, " ".join(self._link_text).strip()))
            self._href = None
        if tag in self.BLOCK:
            self.out.append("\n")

    def handle_data(self, data):
        if self._skip:
            return
        if self._href is not None:
            self._link_text.append(data.strip())
        if not self._nav:
            self.out.append(data)


def _clean_lines(text: str) -> str:
    lines = [re.sub(r"[ \t ]+", " ", ln).strip() for ln in text.splitlines()]
    out: list[str] = []
    for ln in lines:
        if ln in ("|", "-", "- |") or (not ln and out and not out[-1]):
            continue
        out.append(ln)
    return "\n".join(out).strip()


def _decode(body: bytes, ctype: str) -> str:
    m = re.search(r"charset=([\w-]+)", ctype) or re.search(rb"<meta[^>]+charset=[\"']?([\w-]+)", body[:4000], re.I)
    declared = (m.group(1).decode() if isinstance(m.group(1), bytes) else m.group(1)) if m else ""
    for enc in [declared, "utf-8"]:
        if enc:
            try:
                return body.decode(enc)
            except (LookupError, UnicodeDecodeError):
                pass
    return body.decode("cp1252", errors="replace")


def html_text(body: bytes, base_url: str, ctype: str = "") -> tuple[str, list[tuple[str, str]]]:
    raw = _decode(body, ctype)
    m = re.search(r"<main[\s>].*?</main>", raw, re.S | re.I)
    p = _HTMLText()
    p.feed(m.group(0) if m and len(m.group(0)) > 2000 else raw)
    links = [(urljoin(base_url, h), t) for h, t in p.links]
    if m:  # keep links from the whole page (side menus often hold the statute PDFs)
        q = _HTMLText()
        q.feed(raw)
        links += [(urljoin(base_url, h), t) for h, t in q.links]
    return _clean_lines(html.unescape("".join(p.out))), links


def pdf_text(body: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(body))
    pages = []
    for i, page in enumerate(reader.pages, 1):
        try:
            t = page.extract_text() or ""
        except Exception:  # noqa: BLE001 - one broken page shouldn't lose the document
            t = "[this page could not be read]"
        pages.append(f"[page {i}]\n{t.strip()}")
    return _clean_lines("\n\n".join(pages))


def xlsx_text(body: bytes) -> str:
    """Every sheet as rows of `A1: value | B1: value`, so form fields and their labels stay together."""
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    rel_ns = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
    z = zipfile.ZipFile(io.BytesIO(body))
    shared: list[str] = []
    if "xl/sharedStrings.xml" in z.namelist():
        root = ElementTree.fromstring(z.read("xl/sharedStrings.xml"))
        for si in root.findall("m:si", ns):
            shared.append("".join(t.text or "" for t in si.iter("{%s}t" % ns["m"])))
    wb = ElementTree.fromstring(z.read("xl/workbook.xml"))
    rels = ElementTree.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    targets = {r.get("Id"): r.get("Target") for r in rels}
    out = []
    for sheet in wb.findall("m:sheets/m:sheet", ns):
        target = targets.get(sheet.get(rel_ns), "")
        path = "xl/" + target.lstrip("/").removeprefix("xl/")
        if path not in z.namelist():
            continue
        root = ElementTree.fromstring(z.read(path))
        rows = []
        for row in root.iter("{%s}row" % ns["m"]):
            cells = []
            for c in row.findall("m:c", ns):
                v = c.find("m:v", ns)
                inline = c.find("m:is", ns)
                if c.get("t") == "s" and v is not None:
                    val = shared[int(v.text)] if v.text and v.text.isdigit() and int(v.text) < len(shared) else ""
                elif inline is not None:
                    val = "".join(t.text or "" for t in inline.iter("{%s}t" % ns["m"]))
                else:
                    val = v.text if v is not None else ""
                    f = c.find("m:f", ns)
                    if f is not None and f.text and not val:
                        val = "=" + f.text
                if val and val.strip():
                    cells.append(f"{c.get('r')}: {val.strip()}")
            if cells:
                rows.append(" | ".join(cells))
        out.append(f"[sheet {sheet.get('name')}]\n" + "\n".join(rows))
    return "\n\n".join(out)


def docx_text(body: bytes) -> str:
    z = zipfile.ZipFile(io.BytesIO(body))
    xml = z.read("word/document.xml").decode("utf-8", errors="replace")
    xml = re.sub(r"</w:p>", "\n", xml)
    return _clean_lines(html.unescape(re.sub(r"<[^>]+>", "", xml)))


def read_document(url: str) -> dict:
    """{url, final_url, type, text, links, chars, truncated} or {url, error}."""
    try:
        body, ctype, final = fetch(url)
        kind = _kind(final, ctype, body)
        links: list[tuple[str, str]] = []
        if kind == "pdf":
            text = pdf_text(body)
        elif kind == "xlsx":
            text = xlsx_text(body)
        elif kind == "docx":
            text = docx_text(body)
        else:
            text, links = html_text(body, final, ctype)
    except FetchError as e:
        return {"url": url, "error": str(e)}
    except Exception as e:  # noqa: BLE001 - parsers fail in many ways; report and move on
        return {"url": url, "error": f"could not read it ({type(e).__name__}: {str(e)[:120]})"}
    if len(text.strip()) < 200:
        return {"url": url, "final_url": final, "type": kind, "error": "almost no text (the page may need JavaScript or a login)",
                "text": text, "links": links}
    truncated = len(text) > MAX_DOC_CHARS
    return {"url": url, "final_url": final, "type": kind, "text": text[:MAX_DOC_CHARS], "links": links,
            "chars": len(text), "truncated": truncated}


def requirement_links(doc: dict, limit: int = 12) -> list[str]:
    """Links on a page that look like entry rules: statutes, annexes, language pages, checklists."""
    host = urlparse(doc.get("final_url") or doc["url"]).netloc.split(".")[-2:]
    seen, picked = set(), []
    for href, text in doc.get("links") or []:
        href = href.split("#")[0]
        if not href.startswith("http") or href in seen or SKIP_LINK.search(href):
            continue
        seen.add(href)
        same_site = urlparse(href).netloc.split(".")[-2:] == host
        doc_file = re.search(r"\.(pdf|xlsx|docx)(\?|$)", href, re.I)
        if (same_site or doc_file) and (LINK_WORDS.search(text) or LINK_WORDS.search(urlparse(href).path)):
            picked.append((0 if doc_file else 1, href, text))
    picked.sort(key=lambda x: x[0])
    return [f"{h}  ({t[:80]})" if t else h for _, h, t in picked[:limit]]


# ---------------------------------------------------------------- the whole run

def _merge_usage(*parts: dict) -> dict:
    out: dict = {}
    for u in parts:
        for k, v in (u or {}).items():
            out[k] = round(out.get(k, 0) + v, 4) if isinstance(v, (int, float)) and not isinstance(v, bool) else v
    return out


def _read_many(urls: list[tuple[str, str]]) -> list[dict]:
    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=6) as pool:
        docs = list(pool.map(lambda u: read_document(u[0]), urls))
    for d, (_, title) in zip(docs, urls):
        d["title"] = title
    return docs


def _same(a: str, b: str) -> bool:
    norm = lambda u: u.split("#")[0].rstrip("/").replace("http://", "https://").replace("://www.", "://")  # noqa: E731
    return norm(a) == norm(b)


def build(app_id: str) -> tuple[dict, dict]:
    """Find, download and read the official requirement documents, then build and save the checklist."""
    import ai

    item = store.get_application(app_id)
    courses = store.courses()
    previous = load(app_id)
    prev_keys = [it["key"] for it in previous.get("items") or []]

    # 1. The program page and the links on it that look like rules.
    known: list[str] = []
    first: list[dict] = []
    if item.get("url"):
        ai._report(f"Reading {ai._short_url(item['url'])}")
        page = read_document(item["url"])
        page["title"] = "Program page"
        first.append(page)
        known += requirement_links(page, limit=40)
    known += [s for s in [*(item.get("sources") or []), *((item.get("course_check") or {}).get("sources") or [])] if s not in known]

    # 2. Claude names the documents that hold the full rules.
    listed, u1 = ai.requirements_sources(item, known)
    want = [(d["url"], d["title"]) for d in listed if d.get("url", "").startswith("http")]
    want = [(u, t) for i, (u, t) in enumerate(want) if not any(_same(u, x) for x, _ in want[:i])]
    want = [(u, t) for u, t in want if not any(_same(u, d["url"]) for d in first)][: MAX_DOCS - len(first)]
    ai._report(f"Downloading {len(want)} documents")
    docs = first + _read_many(want)

    def numbered(all_docs: list[dict], only: list[dict] | None = None) -> list[dict]:
        out, total = [], 0
        for i, d in enumerate(all_docs, 1):
            d["n"] = i
            if only is not None and not any(d is o for o in only):
                continue
            if d.get("error") or not d.get("text"):
                continue
            room = MAX_TOTAL_CHARS - total
            if room <= 2000:
                d["error"], d["text"] = "left out: the documents together were too long for one reading", ""
                continue
            if len(d["text"]) > room:
                d["text"], d["truncated"] = d["text"][:room], True
                d["chars"] = d.get("chars") or len(d["text"])
            total += len(d["text"])
            pdfs = [ln for ln in requirement_links(d, limit=10) if re.search(r"\.(pdf|xlsx|docx)\b", ln, re.I)] if d.get("type") == "html" else []
            out.append({"n": i, "url": d.get("final_url") or d["url"], "title": d.get("title", ""), "text": d["text"], "pdf_links": pdfs})
        return out

    usage = ai.Usage(ai.MODEL)
    result = ai.requirements_checklist(item, numbered(docs), courses, prev_keys, usage)

    # 3. One follow-up round for annexes / statutes the documents point to but we didn't have.
    extra = [(d["url"], d["title"]) for d in result.get("need_documents") or [] if d.get("url", "").startswith("http")]
    extra = [(u, t) for u, t in extra if not any(_same(u, d["url"]) or _same(u, d.get("final_url", "")) for d in docs)][:6]
    if extra and len(docs) < MAX_DOCS + 6:
        ai._report(f"Fetching {len(extra)} more documents the rules refer to")
        more = _read_many(extra)
        if any(not d.get("error") for d in more):
            docs += more
            numbered(docs)  # number everything, then read only the new ones against the draft checklist
            update = ai.requirements_checklist(item, numbered(docs, only=more), courses, prev_keys, usage,
                                               existing=result.get("items") or [])
            by_key = {it["key"]: it for it in result.get("items") or []}
            for it in update.get("items") or []:
                by_key[it["key"]] = it  # same key replaces the draft item; new keys are added
            result = {**update, "items": list(by_key.values())}

    # 4. Check every quote against the text it claims to come from.
    texts = {d["n"]: d.get("text", "") for d in docs}
    for it in result.get("items") or []:
        for q in it.get("quotes") or []:
            q["verified"] = quote_found(q.get("text", ""), texts.get(q.get("source"), ""))
    keys_seen: dict[str, int] = {}
    for it in result.get("items") or []:  # keys must be unique for your ticks to stick
        k = re.sub(r"[^a-z0-9-]+", "-", (it.get("key") or it.get("title") or "item").lower()).strip("-")[:60] or "item"
        keys_seen[k] = keys_seen.get(k, 0) + 1
        it["key"] = k if keys_seen[k] == 1 else f"{k}-{keys_seen[k]}"

    checklist = {
        "program": f"{item['name']}, {item.get('university', '')}".strip(", "),
        "checked_on": date.today().isoformat(),
        "verdict": result.get("verdict"),
        "summary": result.get("summary", ""),
        "items": result.get("items") or [],
        "unresolved": result.get("unresolved") or [],
        "questions": result.get("questions") or [],
    }
    return {"checklist": checklist, "docs": docs}, _merge_usage(u1, usage.to_dict())


def commit(app_id: str, built: dict) -> dict:
    """Save a finished run (called only when the agent wasn't cancelled). Returns the updated application."""
    checklist = {**built["checklist"], "documents": save_sources(app_id, built["docs"])}
    saved = save(app_id, checklist)
    item = store.get_application(app_id)
    read = [d["url"] for d in checklist["documents"] if d["status"] != "failed"]
    sources = list(dict.fromkeys([*(item.get("sources") or []), *read]))
    return store.update_application(app_id, {"requirements_check": summary(saved), "sources": sources})


# ---------------------------------------------------------------- quote checking

def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s).lower()
    s = s.replace("­", "")  # soft hyphens from PDFs
    s = re.sub(r"(\w)-\s+(\w)", r"\1\2", s)  # words broken across PDF lines
    s = re.sub(r"[‘’‚‛`´]", "'", s)
    s = re.sub(r"[“”„«»]", '"', s)
    s = re.sub(r"[‐-―]", "-", s)
    s = re.sub(r"[^\w%§€.,;:()/'\"+-]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def quote_found(quote: str, source: str) -> str:
    """'exact' when the quote is in the source text, 'close' when most of it is, else 'not found'."""
    q, s = _norm(quote), _norm(source)
    if not q:
        return "not found"
    if q in s:
        return "exact"
    # Allow for "…" elisions and small extraction differences: check overlapping 6-word runs.
    parts = [p.strip() for p in re.split(r"\.\.\.|…|\[\.\.\.\]", q) if p.strip()]
    if len(parts) > 1 and all(p in s for p in parts if len(p) > 12):
        return "exact"
    words = q.split()
    if len(words) < 6:
        return "not found"
    runs = [" ".join(words[i:i + 6]) for i in range(0, len(words) - 5, 3)]
    hit = sum(1 for r in runs if r in s) / len(runs)
    return "close" if hit >= 0.6 else "not found"


# ---------------------------------------------------------------- files

def _paths(app_id: str) -> tuple[Path, Path]:
    folder = store._app_dir(app_id)
    return folder / "Requirements.md", folder / "Requirements" / "Sources"


def _slug(url: str) -> str:
    u = urlparse(url)
    tail = (u.path.rstrip("/").rsplit("/", 1)[-1] or u.netloc)
    tail = re.sub(r"\.(pdf|xlsx|docx|html?|php|aspx)$", "", tail, flags=re.I)
    return re.sub(r"[^A-Za-z0-9]+", "-", tail).strip("-")[:60] or "page"


def save_sources(app_id: str, docs: list[dict]) -> list[dict]:
    """Write each read document's text to Requirements/Sources and return the list the checklist keeps."""
    _, folder = _paths(app_id)
    if folder.is_dir():
        for old in folder.glob("*.txt"):
            old.unlink()
    folder.mkdir(parents=True, exist_ok=True)
    out = []
    for i, d in enumerate(docs, 1):
        entry = {"n": i, "url": d.get("final_url") or d["url"], "type": d.get("type", ""), "title": d.get("title", ""),
                 "status": "read" if not d.get("error") else "failed"}
        if d.get("error"):
            entry["error"] = d["error"]
        if d.get("text") and not d.get("error"):
            name = f"{i:02d}-{_slug(entry['url'])}.txt"
            (folder / name).write_text(f"Source: {entry['url']}\nRead: {date.today().isoformat()}\n\n{d['text']}", encoding="utf-8")
            entry["file"] = f"Requirements/Sources/{name}"
            entry["chars"] = d.get("chars", len(d["text"]))
            if d.get("truncated"):
                entry["status"] = "partly read"
                entry["error"] = f"only the first {MAX_DOC_CHARS:,} of {d['chars']:,} characters were used"
        out.append(entry)
    return out


def source_text(app_id: str, n: int) -> str:
    md, _ = _paths(app_id)
    meta = load(app_id)
    for d in meta.get("documents") or []:
        if d.get("n") == n and d.get("file"):
            path = md.parent / d["file"]
            if path.is_file():
                return path.read_text(encoding="utf-8")
    raise store.NotFound(f"source {n}")


def load(app_id: str) -> dict:
    md, _ = _paths(app_id)
    if not md.is_file():
        return {}
    meta, _ = store.read_doc(md)
    meta.setdefault("mine", {})
    return meta


MINE_FIELDS = {"done", "status", "note"}
MINE_STATUSES = {"", "met", "likely", "maybe", "not met", "unclear", "to do", "not applicable"}


def save(app_id: str, checklist: dict) -> dict:
    """Write a fresh checklist, keeping your own ticks/notes for keys that still exist (and parking the rest)."""
    md, _ = _paths(app_id)
    with store.WRITE_LOCK:
        old = load(app_id)
        mine = dict(old.get("mine") or {})
        keys = {it["key"] for it in checklist.get("items") or []}
        orphans = {k: v for k, v in mine.items() if k not in keys}
        meta = {**checklist, "mine": {k: v for k, v in mine.items() if k in keys}}
        if orphans:  # an item was renamed or dropped: don't silently lose what you wrote
            meta["mine_unmatched"] = {**(old.get("mine_unmatched") or {}), **orphans}
        store.write_doc(md, meta, render_markdown(meta))
    return meta


def set_mine(app_id: str, key: str, patch: dict) -> dict:
    md, _ = _paths(app_id)
    with store.WRITE_LOCK:
        meta = load(app_id)
        if not meta:
            raise store.NotFound("no checklist yet")
        if key not in {it["key"] for it in meta.get("items") or []}:
            raise store.NotFound(key)
        entry = {**(meta["mine"].get(key) or {})}
        for k, v in patch.items():
            if k not in MINE_FIELDS:
                continue
            if k == "done":
                v = bool(v)
            elif k == "status" and v not in MINE_STATUSES:
                raise ValueError(f"status must be one of {sorted(MINE_STATUSES)}")
            elif k == "note":
                v = str(v)[:4000]
            entry[k] = v
        entry = {k: v for k, v in entry.items() if v not in ("", None, False)}
        if entry:
            entry["updated_on"] = date.today().isoformat()
            meta["mine"][key] = entry
        else:
            meta["mine"].pop(key, None)
        store.write_doc(md, meta, render_markdown(meta))
    return meta


def summary(meta: dict) -> dict:
    """Counts for lists and the program README (your own status wins over Claude's)."""
    counts: dict[str, int] = {}
    done = 0
    items = meta.get("items") or []
    for it in items:
        mine = (meta.get("mine") or {}).get(it["key"]) or {}
        st = mine.get("status") or it.get("status")
        counts[st] = counts.get(st, 0) + 1
        done += bool(mine.get("done"))
    return {"verdict": meta.get("verdict"), "items": len(items), "done": done, "counts": counts,
            "checked_on": meta.get("checked_on")}


GROUP_TITLES = {
    "degree": "Degree", "subject-credits": "Subject credits", "courses": "Required courses and topics", "grades": "Grades",
    "language": "Language", "tests": "Tests", "documents": "Documents", "application": "How to apply",
    "selection": "Selection and scoring", "deadlines": "Deadlines", "other": "Other conditions",
}


def render_markdown(meta: dict) -> str:
    """The readable copy below the frontmatter, so Requirements.md makes sense opened on its own."""
    docs = {d["n"]: d for d in meta.get("documents") or []}
    lines = [f"# Entry requirements: {meta.get('program', '')}", ""]
    if meta.get("checked_on"):
        lines += [f"Checked {meta['checked_on']}. Verdict: **{meta.get('verdict', '')}**.", ""]
    if meta.get("summary"):
        lines += [meta["summary"], ""]
    for group, title in GROUP_TITLES.items():
        items = [it for it in meta.get("items") or [] if it.get("group") == group]
        if not items:
            continue
        lines += [f"## {title}", ""]
        for it in items:
            mine = (meta.get("mine") or {}).get(it["key"]) or {}
            box = "[x]" if mine.get("done") else "[ ]"
            status = mine.get("status") or it.get("status")
            lines.append(f"### {box} {it.get('title')} ({status})")
            if it.get("applies_if"):
                lines.append(f"_Applies if: {it['applies_if']}_")
            for q in it.get("quotes") or []:
                d = docs.get(q.get("source"))
                where = ", ".join(x for x in [d and d.get("url"), q.get("location")] if x)
                lines.append("")
                lines += ["> " + ln for ln in (q.get("text") or "").splitlines()]
                if q.get("translation"):
                    lines.append("> ")
                    lines.append(f"> _English: {q['translation']}_")
                lines.append(f"> ({where}; quote {q.get('verified', 'unchecked')})")
            for p in it.get("parts") or []:
                lines.append(f"- **{p.get('label')}**: needs {p.get('required')}; you have {p.get('have')} ({p.get('status')})")
            if it.get("assessment"):
                lines += ["", it["assessment"]]
            if it.get("evidence"):
                lines += ["", "Evidence: " + ", ".join(it["evidence"]) + (f" ({it['ects_counted']} ECTS)" if it.get("ects_counted") is not None else "")]
            if it.get("how"):
                lines += ["", "How to complete:"] + [f"{i}. {s}" for i, s in enumerate(it["how"], 1)]
            if mine.get("note"):
                lines += ["", f"My note: {mine['note']}"]
            lines.append("")
    for title, key in (("Could not be confirmed", "unresolved"), ("Questions for the admissions office", "questions")):
        if meta.get(key):
            lines += [f"## {title}", ""] + [f"- {x}" for x in meta[key]] + [""]
    if docs:
        lines += ["## Documents read", ""]
        for d in docs.values():
            lines.append(f"{d['n']}. {d.get('title') or d['url']} ({d['url']}): {d['status']}" + (f", {d['error']}" if d.get("error") else ""))
    return "\n".join(lines)
