import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { api, type EssayComment, type EssayVersion } from '../api'
import { cx } from '../lib'
import { Button, Input, Spinner, Textarea } from './ui'

// ---------------------------------------------------------------- comment anchors

/**
 * Keep comments on their passage while the draft changes. One edit replaces prev[a, oldEnd) with next[a, a + ins);
 * passages after it shift, typing inside one grows it, and a passage deleted outright is kept as detached (start = end).
 */
export function shiftComments(prev: string, next: string, comments: EssayComment[]): EssayComment[] {
  if (!comments.length || prev === next) return comments
  const max = Math.min(prev.length, next.length)
  let a = 0
  while (a < max && prev[a] === next[a]) a++
  let b = 0
  while (b < max - a && prev[prev.length - 1 - b] === next[next.length - 1 - b]) b++
  const oldEnd = prev.length - b
  const delta = next.length - prev.length
  const ins = oldEnd - a + delta
  return comments.map((c) => {
    if (c.start === c.end) return c
    // Typing right at a passage's first letter pushes it along; typing right after its last letter stays outside it.
    const start = c.start < a ? c.start : c.start >= oldEnd ? c.start + delta : a
    const end = c.end <= a ? c.end : c.end >= oldEnd ? c.end + delta : a + ins
    if (end <= start) return { ...c, start, end: start }
    return { ...c, start, end, quote: next.slice(start, end) }
  })
}

/** After loading or restoring, find each passage again by its quote (the closest match to where it was). */
export function relocateComments(text: string, comments: EssayComment[]): EssayComment[] {
  return comments.map((c) => {
    if (!c.quote) return c
    if (c.start !== c.end && text.slice(c.start, c.end) === c.quote) return c
    let best = -1
    for (let i = text.indexOf(c.quote); i >= 0; i = text.indexOf(c.quote, i + 1)) if (best < 0 || Math.abs(i - c.start) < Math.abs(best - c.start)) best = i
    if (best < 0) return { ...c, start: Math.min(c.start, text.length), end: Math.min(c.start, text.length) }
    return { ...c, start: best, end: best + c.quote.length }
  })
}

const isDetached = (c: EssayComment) => c.start === c.end

/** Widen a selection to whole words and drop the spaces around it, so a rough drag still pins "real world data". */
export function snapToWords(text: string, start: number, end: number): [number, number] {
  const word = /[\p{L}\p{N}'’-]/u
  while (start > 0 && word.test(text[start - 1]) && word.test(text[start])) start--
  while (end < text.length && word.test(text[end]) && word.test(text[end - 1])) end++
  while (start < end && /\s/.test(text[start])) start++
  while (end > start && /\s/.test(text[end - 1])) end--
  return [start, end]
}

// ---------------------------------------------------------------- editor with highlights

// The textarea sits on a mirror of the same text; the mirror draws the highlights and sizes the box, so both wrap alike.
const PAGE = 'block w-full whitespace-pre-wrap break-words px-5 py-8 font-serif text-[1.15rem] leading-[1.85] lg:py-12'

export function CommentedTextarea({
  value,
  onChange,
  onKeyDown,
  comments,
  active,
  onActive,
  onComment,
  areaRef,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  comments: EssayComment[]
  active: string | null
  onActive: (id: string | null) => void
  onComment: (start: number, end: number) => void
  areaRef: RefObject<HTMLTextAreaElement | null>
  placeholder?: string
}) {
  const [sel, setSel] = useState<[number, number]>([0, 0])
  const anchor = useRef<HTMLSpanElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const open = useMemo(() => comments.filter((c) => !c.resolved && !isDetached(c)), [comments])
  const [focused, setFocused] = useState(false)
  const hasSel = focused && sel[1] > sel[0] && value.slice(sel[0], sel[1]).trim() !== ''

  const track = () => {
    const el = areaRef.current
    if (el) setSel([el.selectionStart, el.selectionEnd])
  }
  const click = () => {
    const el = areaRef.current
    if (!el || el.selectionStart !== el.selectionEnd) return
    const at = el.selectionStart
    const hit = open.filter((c) => c.start <= at && at <= c.end).sort((x, y) => x.end - x.start - (y.end - y.start))[0]
    onActive(hit ? hit.id : null)
  }

  // Cut the mirror at every comment edge (and the selection end, for the Comment button).
  const pieces = useMemo(() => {
    const cuts = new Set([0, value.length])
    for (const c of open) cuts.add(c.start).add(c.end)
    if (hasSel) cuts.add(sel[1])
    const points = [...cuts].filter((n) => n >= 0 && n <= value.length).sort((x, y) => x - y)
    const out: ReactNode[] = []
    for (let i = 0; i < points.length - 1; i++) {
      const [s, t] = [points[i], points[i + 1]]
      if (hasSel && s === sel[1]) out.push(<span key="anchor" ref={anchor} />)
      const over = open.filter((c) => c.start <= s && t <= c.end)
      const chunk = value.slice(s, t)
      out.push(
        over.length ? (
          <mark key={s} className={cx('rounded-[2px] border-b-2 text-transparent', over.some((c) => c.id === active) ? 'border-accent bg-accent/30' : 'border-accent/50 bg-accent/12')}>
            {chunk}
          </mark>
        ) : (
          chunk
        ),
      )
    }
    if (hasSel && sel[1] === value.length) out.push(<span key="anchor" ref={anchor} />)
    return out
  }, [value, open, active, hasSel, sel])

  useLayoutEffect(() => {
    const a = anchor.current
    const next = hasSel && a ? { top: a.offsetTop + a.offsetHeight + 4, left: Math.max(0, a.offsetLeft - 40) } : null
    setPos((p) => (p?.top === next?.top && p?.left === next?.left ? p : next))
  }, [hasSel, pieces])

  return (
    <div className="relative mx-auto w-full max-w-[70ch]">
      <div aria-hidden className={cx(PAGE, 'pointer-events-none min-h-[60vh] text-transparent')}>
        {pieces}{' '}
      </div>
      <textarea
        ref={areaRef}
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setSel([e.target.selectionStart, e.target.selectionEnd])
        }}
        onKeyDown={onKeyDown}
        onSelect={track}
        onKeyUp={track}
        onMouseUp={track}
        onClick={click}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        spellCheck
        style={{ outline: 'none' }}
        className={cx(PAGE,'absolute inset-0 h-full resize-none overflow-hidden bg-transparent text-text outline-none placeholder:text-muted/40')}
      />
      {pos && (
        <button
          onMouseDown={(e) => {
            e.preventDefault()
            onComment(sel[0], sel[1])
          }}
          style={{ top: pos.top, left: pos.left }}
          className="absolute z-10 rounded-md bg-panel-2 px-2.5 py-1 font-sans text-xs text-text shadow-lg ring-1 ring-line-strong hover:ring-accent/60"
          title="Comment on the selected words (Ctrl+Alt+M)"
        >
          Comment
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- comments panel

export function CommentsPanel({
  comments,
  pending,
  active,
  onAdd,
  onCancel,
  onChange,
  onDelete,
  onJump,
}: {
  comments: EssayComment[]
  pending: { start: number; end: number; quote: string } | null
  active: string | null
  onAdd: (text: string) => void
  onCancel: () => void
  onChange: (id: string, patch: Partial<EssayComment>) => void
  onDelete: (id: string) => void
  onJump: (c: EssayComment) => void
}) {
  const [draft, setDraft] = useState('')
  const [showResolved, setShowResolved] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const refs = useRef<Record<string, HTMLLIElement | null>>({})
  useEffect(() => setDraft(''), [pending])
  useEffect(() => {
    if (active) refs.current[active]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [active])

  const resolved = comments.filter((c) => c.resolved).length
  const shown = comments.filter((c) => showResolved || !c.resolved).sort((x, y) => x.start - y.start)
  const add = () => draft.trim() && onAdd(draft.trim())

  return (
    <div className="min-h-0 flex-1 overflow-y-auto text-sm">
      {pending && (
        <div className="space-y-2 border-b border-line px-5 py-4">
          <Quote>{pending.quote}</Quote>
          <Textarea
            autoFocus
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) add()
              if (e.key === 'Escape') onCancel()
            }}
            placeholder="Your note on this passage"
          />
          <div className="flex gap-2">
            <Button size="sm" variant="primary" onClick={add} disabled={!draft.trim()}>
              Comment
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {!shown.length && !pending && (
        <p className="px-5 py-4 text-muted">Select words in your draft and press Comment (Ctrl+Alt+M) to leave yourself a note on them.</p>
      )}
      <ul>
        {shown.map((c) => (
          <li
            key={c.id}
            ref={(el) => {
              refs.current[c.id] = el
            }}
            className={cx('border-b border-line px-5 py-3', c.id === active && 'bg-panel', c.resolved && 'opacity-60')}
          >
            <button onClick={() => onJump(c)} disabled={isDetached(c)} className="block w-full text-left" title={isDetached(c) ? undefined : 'Show in the draft'}>
              <Quote gone={isDetached(c)}>{c.quote}</Quote>
            </button>
            {editing === c.id ? (
              <Textarea
                autoFocus
                rows={3}
                defaultValue={c.text}
                className="mt-2"
                onBlur={(e) => {
                  if (e.target.value.trim()) onChange(c.id, { text: e.target.value.trim() })
                  setEditing(null)
                }}
                onKeyDown={(e) => (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) && e.currentTarget.blur()}
              />
            ) : (
              <p onClick={() => setEditing(c.id)} className="mt-2 cursor-text whitespace-pre-wrap" title="Edit">
                {c.text}
              </p>
            )}
            <div className="mt-1.5 flex items-center gap-3 text-xs text-muted">
              <span>{when(c.created)}</span>
              {isDetached(c) && <span>Passage removed</span>}
              <button onClick={() => onChange(c.id, { resolved: !c.resolved })} className="ml-auto hover:text-text">
                {c.resolved ? 'Reopen' : 'Resolve'}
              </button>
              <button onClick={() => onDelete(c.id)} className="hover:text-danger">
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
      {resolved > 0 && (
        <button onClick={() => setShowResolved((v) => !v)} className="px-5 py-3 text-xs text-muted hover:text-text">
          {showResolved ? 'Hide resolved' : `Show ${resolved} resolved`}
        </button>
      )}
    </div>
  )
}

function Quote({ children, gone }: { children: string; gone?: boolean }) {
  return <span className={cx('line-clamp-2 border-l-2 pl-2.5 font-serif text-[0.95rem] italic text-muted', gone ? 'border-line-strong line-through' : 'border-accent/60')}>{children}</span>
}

const when = (iso: string) => {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

// ---------------------------------------------------------------- versions

type Piece = { kind: 'same' | 'add' | 'del'; text: string }

/** Word-level diff (whitespace kept as its own tokens) from `before` to `after`. */
export function wordDiff(before: string, after: string): Piece[] {
  const x = before.split(/(\s+)/).filter(Boolean)
  const y = after.split(/(\s+)/).filter(Boolean)
  let head = 0
  while (head < x.length && head < y.length && x[head] === y[head]) head++
  let tail = 0
  while (tail < x.length - head && tail < y.length - head && x[x.length - 1 - tail] === y[y.length - 1 - tail]) tail++
  const a = x.slice(head, x.length - tail)
  const b = y.slice(head, y.length - tail)
  const n = a.length
  const m = b.length
  // lcs[i][j] = longest common run of a[i:] and b[j:]
  const lcs = new Uint32Array((n + 1) * (m + 1))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) lcs[i * (m + 1) + j] = a[i] === b[j] ? lcs[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(lcs[(i + 1) * (m + 1) + j], lcs[i * (m + 1) + j + 1])
  const out: Piece[] = []
  const push = (kind: Piece['kind'], text: string) => {
    const last = out[out.length - 1]
    if (last && last.kind === kind) last.text += text
    else out.push({ kind, text })
  }
  push('same', x.slice(0, head).join(''))
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      push('same', a[i])
      i++
      j++
    } else if (j < m && (i === n || lcs[i * (m + 1) + j + 1] >= lcs[(i + 1) * (m + 1) + j])) push('add', b[j++])
    else push('del', a[i++])
  }
  push('same', x.slice(x.length - tail).join(''))
  // Readable runs: a stretch of changes (and the bare spaces between them) becomes one removal then one addition.
  const tidy: Piece[] = []
  for (let k = 0; k < out.length; k++) {
    const p = out[k]
    if (p.kind === 'same' && !(/^\s+$/.test(p.text) && k > 0 && k < out.length - 1)) {
      tidy.push(p)
      continue
    }
    let del = ''
    let add = ''
    for (; k < out.length && (out[k].kind !== 'same' || (/^\s+$/.test(out[k].text) && k < out.length - 1)); k++) {
      if (out[k].kind !== 'add') del += out[k].text
      if (out[k].kind !== 'del') add += out[k].text
    }
    k--
    if (del === add) tidy.push({ kind: 'same', text: del })
    else {
      if (del.trim()) tidy.push({ kind: 'del', text: del })
      if (add.trim()) tidy.push({ kind: 'add', text: add })
    }
  }
  return tidy.filter((p) => p.text)
}

const countWords = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0)

/** Read-only view of an old version: what changed between it and your draft, or the version as it was written. */
export function VersionView({ version, current, onRestore, onClose, restoring }: { version: EssayVersion & { text: string }; current: string; onRestore: () => void; onClose: () => void; restoring: boolean }) {
  const [asWritten, setAsWritten] = useState(false)
  const diff = useMemo(() => wordDiff(version.text, current), [version.text, current])
  const added = diff.filter((p) => p.kind === 'add').reduce((n, p) => n + countWords(p.text), 0)
  const removed = diff.filter((p) => p.kind === 'del').reduce((n, p) => n + countWords(p.text), 0)
  const same = version.text === current
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-panel px-5 py-2.5 text-sm lg:px-8">
        <span>
          {versionName(version)} <span className="text-muted">{when(version.saved_at)}</span>
        </span>
        {!asWritten && !same && (
          <span className="num text-xs text-muted">
            <span className="text-t-green">+{added}</span> <span className="text-t-red">−{removed}</span> words since
          </span>
        )}
        {same && <span className="text-xs text-muted">Same as your draft</span>}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setAsWritten((v) => !v)} className="text-xs text-muted hover:text-text">
            {asWritten ? 'Show changes' : 'Show as written'}
          </button>
          <Button size="sm" onClick={onRestore} loading={restoring} disabled={same} title="Your current draft is kept as a version first">
            Restore this version
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Back to draft
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={cx(PAGE, 'mx-auto max-w-[70ch] text-text')}>
          {asWritten
            ? version.text
            : diff.map((p, i) =>
                p.kind === 'same' ? (
                  <span key={i}>{p.text}</span>
                ) : p.kind === 'add' ? (
                  <ins key={i} className="rounded-[2px] bg-t-green/20 no-underline" title="Added since">
                    {p.text}
                  </ins>
                ) : (
                  <del key={i} className="mr-[0.2em] rounded-[2px] bg-t-red/10 text-t-red decoration-t-red/60" title="Removed since">
                    {p.text}
                  </del>
                ),
              )}
        </div>
      </div>
    </div>
  )
}

export const versionName = (v: EssayVersion) => v.label || (v.auto ? 'Autosave' : 'Version')

export function HistoryPanel({ app, essay, words, viewing, onView, onSave, refresh }: { app: string; essay: string; words: number; viewing: string | null; onView: (id: string) => void; onSave: (label: string) => Promise<void>; refresh: number }) {
  const [versions, setVersions] = useState<EssayVersion[] | null>(null)
  const [label, setLabel] = useState('')
  const [saving, setSaving] = useState(false)
  const [naming, setNaming] = useState<string | null>(null)
  const load = () => api.essayVersions(app, essay).then(setVersions)
  useEffect(() => {
    load()
  }, [app, essay, refresh]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setSaving(true)
    try {
      await onSave(label.trim())
      setLabel('')
    } finally {
      setSaving(false)
    }
  }
  const rename = async (v: EssayVersion, value: string) => {
    setNaming(null)
    if (value.trim() && value.trim() !== v.label) await api.renameEssayVersion(app, essay, v.id, value.trim())
    load()
  }
  const remove = async (v: EssayVersion) => {
    if (!confirm(`Delete “${versionName(v)}” from ${when(v.saved_at)}?`)) return
    await api.deleteEssayVersion(app, essay, v.id)
    load()
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto text-sm">
      <div className="flex gap-2 border-b border-line px-5 py-4">
        <Input value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} placeholder="Name it (optional)" className="h-8 text-sm" />
        <Button size="sm" variant="primary" onClick={save} loading={saving} disabled={!words} className="shrink-0">
          Save version
        </Button>
      </div>
      {!versions ? (
        <div className="p-5">
          <Spinner className="text-muted" />
        </div>
      ) : !versions.length ? (
        <p className="px-5 py-4 text-muted">No versions yet. One is kept as you write (every half hour), before each coach review and when you mark it final. Save one yourself before a big rewrite.</p>
      ) : (
        <ul>
          {versions.map((v) => (
            <li key={v.id} className={cx('group border-b border-line', v.id === viewing && 'bg-panel')}>
              {naming === v.id ? (
                <div className="px-5 py-2.5">
                  <Input autoFocus defaultValue={v.label} className="h-8 text-sm" onBlur={(e) => rename(v, e.target.value)} onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && e.currentTarget.blur()} />
                </div>
              ) : (
                <button onClick={() => onView(v.id)} className="flex w-full items-baseline gap-3 px-5 py-2.5 text-left hover:bg-panel">
                  <span className={cx('min-w-0 flex-1 truncate', v.auto ? 'text-muted' : 'text-text', v.id === viewing && 'text-live')}>{versionName(v)}</span>
                  <span className="num shrink-0 text-xs text-muted">{v.words} words</span>
                  <span className="shrink-0 text-xs text-muted">{when(v.saved_at)}</span>
                </button>
              )}
              <div className="flex gap-3 px-5 pb-2 text-xs text-muted md:hidden md:group-hover:flex">
                <button onClick={() => setNaming(v.id)} className="hover:text-text">
                  {v.label && !v.auto ? 'Rename' : 'Name it'}
                </button>
                <button onClick={() => remove(v)} className="hover:text-danger">
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
