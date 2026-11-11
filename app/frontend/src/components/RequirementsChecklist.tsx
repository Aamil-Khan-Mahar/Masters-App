import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Application, type ReqDocument, type ReqItem, type ReqMine, type ReqQuote, type ReqStatus, type Requirements } from '../api'
import { useData } from '../data'
import { useReadOnly } from '../readOnly'
import { cx, formatDate } from '../lib'
import { Button, ExternalLink, Modal, Select, Spinner, Tag, Textarea } from './ui'

export const REQ_GROUPS: { id: ReqItem['group']; label: string }[] = [
  { id: 'degree', label: 'Degree' },
  { id: 'subject-credits', label: 'Subject credits' },
  { id: 'courses', label: 'Required courses and topics' },
  { id: 'grades', label: 'Grades' },
  { id: 'language', label: 'Language' },
  { id: 'tests', label: 'Tests' },
  { id: 'documents', label: 'Documents to submit' },
  { id: 'application', label: 'How to apply' },
  { id: 'selection', label: 'Selection and scoring' },
  { id: 'deadlines', label: 'Deadlines' },
  { id: 'other', label: 'Other conditions' },
]
const STATUSES: ReqStatus[] = ['met', 'likely', 'maybe', 'not met', 'unclear', 'to do', 'not applicable']
// Hard requirements: pass/fail or scored rules about who can be admitted (not documents, steps or deadlines).
const HARD_GROUPS = new Set<ReqItem['group']>(['degree', 'subject-credits', 'courses', 'grades', 'language', 'tests', 'other'])
/** A pass/fail or scored rule about who can be admitted, as opposed to a document, step or deadline. */
export const isHardRequirement = (it: Pick<ReqItem, 'kind' | 'group'>) =>
  (it.kind === 'must' || it.kind === 'conditional' || it.kind === 'scored') && HARD_GROUPS.has(it.group)
const statusLabel = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Tab label: "Entry requirements 4" when four items are still open. */
export function reqLabel(app: Application) {
  const c = app.requirements_check
  if (!c?.items) return 'Entry requirements'
  const open = (c.counts['not met'] ?? 0) + (c.counts.maybe ?? 0) + (c.counts.unclear ?? 0)
  return open ? `Entry requirements ${open}` : 'Entry requirements'
}

/** Every official entry requirement for one program, quoted exactly, checked against you, with how to complete each. */
export default function RequirementsChecklist({ app }: { app: Application }) {
  const { runJob, runningJob, meta } = useData()
  const ro = useReadOnly()
  const busy = runningJob('requirements', app.id)
  const [data, setData] = useState<Requirements | null>(null)
  const [error, setError] = useState('')
  const [source, setSource] = useState<{ doc: ReqDocument; quote?: string } | null>(null)

  const stamp = app.requirements_check?.checked_on
  useEffect(() => {
    let live = true
    api.requirements(app.id).then((d) => live && setData(d)).catch((e) => live && setError(String(e.message ?? e)))
    return () => {
      live = false
    }
  }, [app.id, stamp, !!busy])

  const run = () => runJob((strong) => api.buildRequirements(app.id, strong)).catch(() => undefined)
  const mark = async (key: string, patch: ReqMine) => {
    setData((d) => (d ? { ...d, mine: { ...d.mine, [key]: { ...d.mine[key], ...patch } } } : d))
    try {
      setData(await api.markRequirement(app.id, key, patch))
    } catch (e) {
      setError(String((e as Error).message ?? e))
    }
  }

  const items = data?.items ?? []
  const mine = data?.mine ?? {}
  const effective = (it: ReqItem): ReqStatus => (mine[it.key]?.status || it.status) as ReqStatus
  const docs = useMemo(() => Object.fromEntries((data?.documents ?? []).map((d) => [d.n, d])), [data?.documents])

  const button = !ro && (
    <Button size="sm" variant={data?.checked_on ? 'subtle' : 'primary'} onClick={run} loading={!!busy} disabled={!meta?.ai_configured || !!busy}>
      {busy ? 'Reading the rules…' : data?.checked_on ? 'Check again' : 'Build the checklist'}
    </Button>
  )

  if (!data) return error ? <p className="text-sm text-danger">{error}</p> : <Spinner className="text-live" />

  if (!data.checked_on)
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-line-strong/70 px-5 py-4">
        <p className="max-w-[75ch] text-sm leading-relaxed text-muted">
          {busy
            ? `The ${busy.agent} is downloading the official admission pages, statutes and annexes, then going through them line by line. ${busy.activity[busy.activity.length - 1]?.text ?? ''}`
            : 'Download the official admission page, statutes, annexes and forms, quote every entry requirement exactly, and check each one against your courses, grades and tests, with how to complete it.'}
        </p>
        {button}
      </div>
    )

  const applies = (it: ReqItem) => !(it.kind === 'conditional' && it.applies_to_you === 'no') && effective(it) !== 'not applicable'
  const sections = splitSections(items.filter(applies))
  const notForYou = items.filter((it) => !applies(it))
  const gates = sections.apply
  const count = (s: ReqStatus) => gates.filter((it) => effective(it) === s).length
  const failed = (data.documents ?? []).filter((d) => d.status !== 'read')
  const row = (it: ReqItem) => (
    <Item key={it.key} it={it} mine={mine[it.key] ?? {}} docs={docs} onMark={(p) => mark(it.key, p)} onSource={(doc, quote) => setSource({ doc, quote })} />
  )

  return (
    <div className="max-w-[1100px]">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Tag family="eligibility" value={data.verdict} />
        <span className="text-sm">
          {gates.length} conditions to apply:{' '}
          {(['not met', 'maybe', 'unclear', 'likely', 'met', 'to do'] as ReqStatus[])
            .filter(count)
            .map((s) => `${count(s)} ${s}`)
            .join(', ')}
        </span>
        <span className="text-xs text-muted">Checked {formatDate(data.checked_on)}</span>
        <div className="ml-auto">{button}</div>
      </div>
      {busy && <p className="mb-4 border-l-2 border-live pl-3 text-sm text-muted">Checking again. {busy.activity[busy.activity.length - 1]?.text}</p>}
      {failed.length > 0 && (
        <p className="mb-4 text-sm text-warn">
          {failed.length} official document{failed.length === 1 ? '' : 's'} could not be read, so a rule may be missing. See Sources below.
        </p>
      )}

      <ReqSection title="Can I apply?" note="Every condition you have to meet to be considered, including the ones for your country.">
        {APPLY_TOPICS.map((t) => {
          const list = gates.filter((it) => topicOf(it) === t.id)
          if (!list.length) return null
          return (
            <div key={t.id} className="mt-5 first:mt-0">
              <h4 className="text-xs tracking-wide text-muted uppercase">{t.label}</h4>
              <ul className="divide-y divide-line">{list.map(row)}</ul>
            </div>
          )
        })}
        {!gates.length && <p className="text-sm text-muted">None found in the official documents.</p>}
      </ReqSection>
      <ReqSection title="Ways in if you fall short" note="Provisional admission, alternative routes and conditions you can make up later.">
        {sections.ways.length ? <ul className="divide-y divide-line">{sections.ways.map(row)}</ul> : <p className="text-sm text-muted">None found in the official documents.</p>}
      </ReqSection>
      <ReqSection title="How you're ranked" note="What counts once you're eligible: criteria, points, thresholds and interviews.">
        {sections.ranked.length ? <ul className="divide-y divide-line">{sections.ranked.map(row)}</ul> : <p className="text-sm text-muted">None found in the official documents.</p>}
      </ReqSection>
      <ReqSection title="What to submit and when" note="Documents, their form, the application steps and deadlines.">
        {sections.submit.length ? <ul className="divide-y divide-line">{sections.submit.map(row)}</ul> : <p className="text-sm text-muted">None found in the official documents.</p>}
      </ReqSection>
      {sections.money.length > 0 && <p className="mt-6 text-sm text-muted">Tuition and scholarship conditions are in Funding and money.</p>}

      {notForYou.length > 0 && (
        <Fold title={`Rules that don't apply to you (${notForYou.length})`} quiet>
          <ul className="space-y-1.5 text-sm text-muted">
            {notForYou.map((it) => (
              <li key={it.key}>
                {it.title}
                {it.applies_if && <span className="text-xs"> (only for applicants {it.applies_if.replace(/^applies (only )?(if|to)\s*/i, '')})</span>}
              </li>
            ))}
          </ul>
        </Fold>
      )}
      {(data.questions?.length ?? 0) > 0 && (
        <Fold title={`Questions to ask the admissions office (${data.questions!.length})`} quiet>
          <Bullets title="" items={data.questions} />
        </Fold>
      )}

      <Fold title={`Sources (${(data.documents ?? []).length} official documents)`} quiet>
        <ol className="divide-y divide-line text-sm">
          {(data.documents ?? []).map((d) => (
            <li key={d.n} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
              <span className="num w-6 text-muted">{d.n}</span>
              <span className="min-w-0 flex-1">
                {d.title || d.url.replace(/^https?:\/\/(www\.)?/, '')}
                {d.error && <span className="ml-2 text-xs text-warn">{d.error}</span>}
              </span>
              {d.file && (
                <button className="text-xs text-live hover:underline" onClick={() => setSource({ doc: d })}>
                  Text the app read
                </button>
              )}
              <ExternalLink href={d.url} className="text-xs">
                Original
              </ExternalLink>
            </li>
          ))}
        </ol>
      </Fold>

      <SourceModal app={app} open={source} onClose={() => setSource(null)} />
    </div>
  )
}

// ---------------------------------------------------------------- sections (the same in every program)

const ACADEMIC = new Set<ReqItem['group']>(['degree', 'subject-credits', 'courses', 'grades', 'language', 'tests'])
export const APPLY_TOPICS: { id: ReqItem['group']; label: string }[] = [
  { id: 'degree', label: 'Degree' },
  { id: 'subject-credits', label: 'Subject credits' },
  { id: 'courses', label: 'Required courses and topics' },
  { id: 'grades', label: 'Grades' },
  { id: 'language', label: 'English' },
  { id: 'tests', label: 'Tests' },
  { id: 'other', label: 'Other conditions' },
]
const MONEY = /tuition|scholarship|waiver|stipend|semester (fee|contribution)|living cost|financial|grant\b/i
const WAYS_IN = /provisional|preparatory|pre-?master|interview route|reduced minim|recogni\w* of prior|instead of the|make (it )?up|supplementary|foundation exams|alternative route/i
// Things that happen after you're admitted belong with submitting, not with whether you can apply.
const AFTER = /residence permit|visa\b|deferr?al|enrol|after (\(conditional\) )?admission|if (conditionally )?admitted|accept the offer/i
const RANKED = /selection|ranked|ranking|points?\b|score[sd]? \d|interview/i

const text = (it: ReqItem) => `${it.title} ${it.applies_if}`
/** Which of the four requirement sections (or Funding) an item belongs in. Rules only, so it costs nothing to change. */
export function sectionOf(it: ReqItem): 'apply' | 'ways' | 'ranked' | 'submit' | 'money' {
  if (MONEY.test(text(it)) && !ACADEMIC.has(it.group)) return 'money'
  if (AFTER.test(it.title)) return 'submit'
  if (WAYS_IN.test(it.title)) return 'ways'
  if (it.group === 'selection' || (it.kind === 'scored' && !ACADEMIC.has(it.group)) || (it.group === 'other' && RANKED.test(it.title) && it.kind !== 'must'))
    return 'ranked'
  if (ACADEMIC.has(it.group) && it.kind !== 'document' && it.kind !== 'step') return 'apply'
  if (it.group === 'other' && (it.kind === 'must' || it.kind === 'conditional')) return 'apply'
  return 'submit'
}
const topicOf = (it: ReqItem): ReqItem['group'] => (ACADEMIC.has(it.group) ? it.group : 'other')
/** Documents first, then the application steps, then deadlines and what comes after; source order within each. */
const SUBMIT_ORDER: Partial<Record<ReqItem['group'], number>> = { documents: 0, application: 1, deadlines: 2 }

export function splitSections(items: ReqItem[]) {
  const out = { apply: [] as ReqItem[], ways: [] as ReqItem[], ranked: [] as ReqItem[], submit: [] as ReqItem[], money: [] as ReqItem[] }
  for (const it of items) out[sectionOf(it)].push(it)
  out.submit.sort((a, b) => (SUBMIT_ORDER[a.group] ?? 3) - (SUBMIT_ORDER[b.group] ?? 3))
  return out
}

function ReqSection({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="mt-10 first-of-type:mt-6">
      <div className="mb-2 border-b border-line-strong pb-2">
        <h3 className="font-display text-xl">{title}</h3>
        <p className="mt-0.5 text-xs text-muted">{note}</p>
      </div>
      {children}
    </section>
  )
}

/** The tuition and scholarship conditions from the official rules, for the Funding tab. */
export function RequirementsMoney({ app }: { app: Application }) {
  const [data, setData] = useState<Requirements | null>(null)
  const stamp = app.requirements_check?.checked_on
  useEffect(() => {
    api.requirements(app.id).then(setData).catch(() => setData(null))
  }, [app.id, stamp])
  const mark = async (key: string, patch: ReqMine) => setData(await api.markRequirement(app.id, key, patch))
  const items = (data?.items ?? []).filter((it) => sectionOf(it) === 'money' && !(it.kind === 'conditional' && it.applies_to_you === 'no'))
  const docs = Object.fromEntries((data?.documents ?? []).map((d) => [d.n, d]))
  if (!items.length) return null
  return (
    <section>
      <div className="mb-2 border-b border-line-strong pb-2">
        <h3 className="font-display text-xl">Money in the official rules</h3>
        <p className="mt-0.5 text-xs text-muted">Tuition, fees and scholarship conditions, from the same documents as the requirements.</p>
      </div>
      <ul className="divide-y divide-line">
        {items.map((it) => (
          <Item key={it.key} it={it} mine={data!.mine[it.key] ?? {}} docs={docs} onMark={(p) => mark(it.key, p)} onSource={(d) => window.open(d.url, '_blank', 'noreferrer')} />
        ))}
      </ul>
    </section>
  )
}

function Item({ it, mine, docs, onMark, onSource }: {
  it: ReqItem
  mine: ReqMine
  docs: Record<number, ReqDocument>
  onMark: (p: ReqMine) => void
  onSource: (d: ReqDocument, quote: string) => void
}) {
  const status = (mine.status || it.status) as ReqStatus
  const [note, setNote] = useState(mine.note ?? '')
  const [editing, setEditing] = useState(false)
  const [wording, setWording] = useState(false)
  useEffect(() => setNote(mine.note ?? ''), [mine.note])

  return (
    <li id={`req-${it.key}`} className={cx('py-5', mine.done && 'opacity-55')}>
      {/* The requirement, in English */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h4 className={cx('text-[1.02rem] leading-snug font-medium', mine.done && 'line-through decoration-muted')}>{it.title}</h4>
        <span className="text-xs text-muted">{REQ_GROUPS.find((g) => g.id === it.group)?.label}</span>
        {it.quotes.length > 0 && (
          <button onClick={() => setWording((w) => !w)} className="text-xs text-live hover:underline">
            {wording ? 'Hide official wording' : 'Official wording'}
          </button>
        )}
      </div>
      {it.kind === 'conditional' && it.applies_if && (
        <p className="mt-0.5 text-sm text-muted">Only for applicants {it.applies_if.replace(/^applies (only )?(if|to)\s*/i, '')}</p>
      )}
      {wording && (
        <div className="mt-2 space-y-2">
          {it.quotes.map((q, i) => (
            <Quote key={i} q={q} doc={docs[q.source]} onSource={onSource} />
          ))}
        </div>
      )}

      <div className="mt-3 space-y-3 border-l border-line-strong pl-4 sm:ml-1">
        {/* Status, and the evidence for it */}
        <div className="flex flex-wrap gap-x-2 gap-y-1.5">
          <span className="w-28 shrink-0 pt-0.5 text-xs text-muted">Status</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Tag family="req" value={status}>
                {statusLabel(status)}
                {mine.status ? ' (your call)' : ''}
              </Tag>
              {it.ects_counted != null && (
                <span className="num text-sm">
                  {it.ects_counted} {it.ects_required != null ? `of ${it.ects_required} ` : ''}ECTS counted
                </span>
              )}
            </div>
            {it.assessment && (
              <div className="mt-1.5">
                <Short text={it.assessment} />
              </div>
            )}
            {it.parts.length > 0 && (
              <ul className="mt-2 space-y-1 text-sm">
                {it.parts.map((p, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-x-2">
                    <Tag family="req" value={p.status} className="shrink-0" />
                    <span className="font-medium">{p.label}</span>
                    <span className="num text-muted">needs {p.required}</span>
                    {p.evidence.length > 0 && <Evidence codes={p.evidence} />}
                  </li>
                ))}
              </ul>
            )}
            {!it.parts.length && it.evidence.length > 0 && (
              <div className="mt-1.5 text-sm">
                <Evidence codes={it.evidence} />
              </div>
            )}
          </div>
        </div>

        {/* What you need to do */}
        <div className="flex flex-wrap gap-x-2 gap-y-1.5">
          <span className="w-28 shrink-0 pt-0.5 text-xs text-muted">What you need to do</span>
          <div className="min-w-0 flex-1">
            {it.how.length ? (
              <ol className="max-w-[78ch] list-decimal space-y-1 pl-5 text-sm leading-relaxed marker:text-muted">
                {it.how.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted">Nothing, you meet this.</p>
            )}
            {it.deadline && <p className="mt-1 text-xs text-muted">By {it.deadline}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={!!mine.done} onChange={(e) => onMark({ done: e.target.checked })} className="h-4 w-4 accent-[var(--color-live)]" />
                Done
              </label>
              <button onClick={() => setEditing((e) => !e)} className="text-xs text-muted hover:text-text">
                {editing ? 'Close' : mine.note ? 'Edit my note' : 'Edit'}
              </button>
              {mine.note && !editing && <span className="text-xs text-text/80">{mine.note}</span>}
            </div>
            {editing && (
              <div className="mt-2 flex flex-wrap items-start gap-3">
                <Select value={mine.status ?? ''} onChange={(e) => onMark({ status: e.target.value as ReqStatus | '' })} className="w-auto text-sm" aria-label="Your status">
                  <option value="">Status: Claude's ({it.status})</option>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      Status: {s}
                    </option>
                  ))}
                </Select>
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  onBlur={() => note !== (mine.note ?? '') && onMark({ note })}
                  placeholder="Your note (emailed the office, ordered a certified copy…)"
                  rows={2}
                  className="min-w-[16rem] flex-1 text-sm"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </li>
  )
}

/** The first two sentences, with the rest one click away. */
function Short({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [text]
  const head = sentences.slice(0, 2).join('').trim()
  const more = head.length < text.trim().length
  return (
    <p className="max-w-[78ch] text-sm leading-relaxed text-text/85">
      {open || !more ? text : head}{' '}
      {more && (
        <button onClick={() => setOpen((o) => !o)} className="text-xs text-live hover:underline">
          {open ? 'Less' : 'More'}
        </button>
      )}
    </p>
  )
}

function Fold({ title, quiet, children }: { title: string; quiet?: boolean; children: React.ReactNode }) {
  return (
    <details className="group mt-8">
      <summary className={cx('cursor-pointer list-none border-b border-line pb-2 select-none', quiet ? 'text-sm text-muted hover:text-text' : 'font-display text-lg')}>
        <span className="mr-2 inline-block text-muted transition-transform group-open:rotate-90">›</span>
        {title}
      </summary>
      <div className="pt-2">{children}</div>
    </details>
  )
}

function Quote({ q, doc, onSource }: { q: ReqQuote; doc?: ReqDocument; onSource: (d: ReqDocument, quote: string) => void }) {
  const check =
    q.verified === 'exact' ? (
      <span className="text-t-green">Word for word in the source</span>
    ) : q.verified === 'close' ? (
      <span className="text-t-yellow">Close match to the source, compare it</span>
    ) : (
      <span className="text-danger">Not found in the source text, check the original</span>
    )
  return (
    <figure className="max-w-[85ch] border-l-2 border-line-strong pl-4">
      <blockquote className="text-sm leading-relaxed whitespace-pre-line text-text/95">{q.text}</blockquote>
      {q.translation && <p className="mt-1.5 text-sm leading-relaxed text-muted italic">{q.translation}</p>}
      <figcaption className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
        {doc ? (
          doc.file ? (
            <button className="text-live hover:underline" onClick={() => onSource(doc, q.text)}>
              {doc.title || 'Document ' + doc.n}
            </button>
          ) : (
            <ExternalLink href={doc.url}>{doc.title || doc.url}</ExternalLink>
          )
        ) : (
          <span>Document {q.source}</span>
        )}
        {q.location && <span>{q.location}</span>}
        {check}
      </figcaption>
    </figure>
  )
}

function Evidence({ codes }: { codes: string[] }) {
  return (
    <span className="ml-1 inline-flex flex-wrap gap-x-2">
      {codes.map((c) =>
        /^[A-Z]{2,5}\s?\d{2,4}[A-Z]?$/.test(c) ? (
          <Link key={c} to={`/you/courses?course=${encodeURIComponent(c)}`} className="num text-live hover:underline">
            {c}
          </Link>
        ) : (
          <span key={c} className="text-muted">
            {c}
          </span>
        ),
      )}
    </span>
  )
}

/** The exact text the app downloaded, with the quote highlighted. */
function SourceModal({ app, open, onClose }: { app: Application; open: { doc: ReqDocument; quote?: string } | null; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null)
  const mark = useRef<HTMLElement>(null)
  useEffect(() => {
    setText(null)
    if (open) api.requirementSource(app.id, open.doc.n).then((r) => setText(r.text)).catch((e) => setText(`Could not load it: ${e.message}`))
  }, [app.id, open])
  useEffect(() => {
    mark.current?.scrollIntoView({ block: 'center' })
  }, [text])

  let body: React.ReactNode = text
  if (text && open?.quote) {
    const at = findQuote(text, open.quote)
    if (at) body = (
      <>
        {text.slice(0, at[0])}
        <mark ref={mark} className="bg-accent/30 text-text">
          {text.slice(at[0], at[1])}
        </mark>
        {text.slice(at[1])}
      </>
    )
  }
  return (
    <Modal open={!!open} onClose={onClose} title={open?.doc.title || 'Source'} wide>
      <div className="mb-2 flex flex-wrap gap-3 text-xs">
        {open && <ExternalLink href={open.doc.url}>Open the original</ExternalLink>}
        <span className="text-muted">The text the app extracted from it, which every quote is checked against.</span>
      </div>
      {text === null ? <Spinner className="text-live" /> : <pre className="max-h-[70vh] overflow-auto text-xs leading-relaxed whitespace-pre-wrap">{body}</pre>}
    </Modal>
  )
}

/** Where the quote sits in the text, tolerant of line breaks and spacing: [start, end] or null. */
function findQuote(text: string, quote: string): [number, number] | null {
  const words = quote.split(/[\s…]+/).filter((w) => w.length > 0).slice(0, 12)
  for (let n = words.length; n >= 4; n--) {
    const pattern = words.slice(0, n).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\-]+')
    const m = new RegExp(pattern, 'i').exec(text)
    if (m) {
      const end = Math.min(text.length, m.index + Math.max(m[0].length, quote.length + 20))
      return [m.index, end]
    }
  }
  return null
}

function Bullets({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null
  return (
    <div>
      <div className="mb-2 text-xs text-muted">{title}</div>
      <ul className="space-y-1.5 text-sm leading-relaxed">
        {items.map((x, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="mt-[0.55rem] h-1 w-1 shrink-0 rounded-full bg-muted" />
            <span>{x}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
