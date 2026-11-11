"""Essay PDFs: your statement exactly as you wrote it, typeset with Tectonic beside the draft (SOP.md -> SOP.pdf).

Only layout is added (title, your name, the program); the words are yours. Markdown is kept to what the editor
produces: paragraphs, **bold**, _italic_ / *italic*, "# headings" and "- " or "1. " lists.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
from pathlib import Path

import resume
import store

_SPECIAL = {"\\": r"\textbackslash{}", "&": r"\&", "%": r"\%", "$": r"\$", "#": r"\#", "_": r"\_", "{": r"\{", "}": r"\}", "~": r"\textasciitilde{}", "^": r"\textasciicircum{}"}
_MARK = re.compile(r"(\*\*[^*\n]+\*\*|\*[^*\n]+\*|(?<![A-Za-z0-9])_[^_\n]+_(?![A-Za-z0-9]))")


def _esc(text: str) -> str:
    return "".join(_SPECIAL.get(c, c) for c in text)


def _inline(text: str) -> str:
    out = []
    for part in _MARK.split(text):
        if part.startswith("**") and part.endswith("**") and len(part) > 4:
            out.append(r"\textbf{" + _esc(part[2:-2]) + "}")
        elif len(part) > 2 and ((part[0] == part[-1] == "*") or (part[0] == part[-1] == "_")):
            out.append(r"\emph{" + _esc(part[1:-1]) + "}")
        else:
            out.append(_esc(part))
    return "".join(out)


def to_latex(md: str) -> str:
    blocks = re.split(r"\n\s*\n", md.replace("\r\n", "\n").strip())
    out = []
    for block in blocks:
        lines = [l.rstrip() for l in block.split("\n") if l.strip()]
        if not lines:
            continue
        if len(lines) == 1 and (m := re.match(r"^#{1,6}\s+(.*)$", lines[0])):
            out.append(r"\subsection*{" + _inline(m.group(1)) + "}")
        elif all(re.match(r"^\s*[-*]\s+", l) for l in lines):
            items = "\n".join(r"  \item " + _inline(re.sub(r"^\s*[-*]\s+", "", l)) for l in lines)
            out.append("\\begin{itemize}\n" + items + "\n\\end{itemize}")
        elif all(re.match(r"^\s*\d+[.)]\s+", l) for l in lines):
            items = "\n".join(r"  \item " + _inline(re.sub(r"^\s*\d+[.)]\s+", "", l)) for l in lines)
            out.append("\\begin{enumerate}\n" + items + "\n\\end{enumerate}")
        else:
            out.append(_inline(" ".join(l.strip() for l in lines)))
    return "\n\n".join(out)


TEMPLATE = r"""\documentclass[11pt]{article}
\usepackage[margin=1in]{geometry}
\usepackage{fontspec}
\setmainfont{texgyretermes}[Extension=.otf, UprightFont=*-regular, BoldFont=*-bold, ItalicFont=*-italic, BoldItalicFont=*-bolditalic]
\setlength{\parindent}{0pt}
\setlength{\parskip}{8pt}
\linespread{1.15}
\pagestyle{plain}
\begin{document}
{\centering{\Large\bfseries %(title)s}\par\vspace{4pt}%(byline)s\par}
\vspace{14pt}
%(body)s
\end{document}
"""


_SMALL = {"a", "an", "and", "as", "at", "but", "by", "for", "in", "of", "on", "or", "the", "to", "with"}


def _title_case(title: str) -> str:
    """"Statement of purpose" -> "Statement of Purpose" for the document heading."""
    words = title.split()
    return " ".join(w if (i and w.lower() in _SMALL) or not w[:1].islower() else w[:1].upper() + w[1:] for i, w in enumerate(words))


def pdf_path(app_id: str, essay_id: str) -> Path:
    return store._app_dir(app_id) / f"{store._essay_stem(essay_id)}.pdf"


def build(app_id: str, essay_id: str, title: str) -> Path:
    """Typeset the saved draft to <stem>.pdf beside it. Raises resume.ResumeError if there's nothing to typeset or LaTeX fails."""
    text = store.get_sop(app_id, essay_id)
    if not text.strip():
        raise resume.ResumeError("The draft is empty.")
    exe = resume.tectonic()
    if not exe:
        raise resume.ResumeError("Tectonic isn't installed, so the PDF can't be made.")
    item = store.get_application(app_id)
    name = (store.get_profile().get("name") or "").strip()
    program = ", ".join(x for x in [item.get("name") if item.get("kind") == "program" else "", item.get("university") or item.get("provider") or (item.get("name") if item.get("kind") != "program" else "")] if x)
    byline = r"\\[2pt]".join(_esc(x) for x in [name, program] if x)
    tex = TEMPLATE % {"title": _esc(_title_case(title)), "byline": byline, "body": to_latex(text)}
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "essay.tex"
        src.write_text(tex, encoding="utf-8")
        try:
            proc = subprocess.run([exe, "-X", "compile", "essay.tex"], cwd=tmp, capture_output=True, text=True, timeout=300,
                                  creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except subprocess.TimeoutExpired as e:
            raise resume.ResumeError("LaTeX took too long.") from e
        pdf = Path(tmp) / "essay.pdf"
        if proc.returncode != 0 or not pdf.is_file():
            tail = "\n".join((proc.stderr or proc.stdout or "").strip().splitlines()[-6:])
            raise resume.ResumeError(f"LaTeX failed:\n{tail}")
        dest = pdf_path(app_id, essay_id)
        shutil.copyfile(pdf, dest)
    return dest
