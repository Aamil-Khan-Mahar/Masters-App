import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Application, type AskEntry } from '../api'
import { useData } from '../data'
import { applyPath } from '../applyTasks'
import { cx, formatDate } from '../lib'
import { Button, ExternalLink, Markdown, Spinner, Tag } from './ui'

// What each changeable field is called, and which tab shows it.
const FIELD: Record<string, [string, string]> = {
  deadlines: ['Deadlines', 'application'],
  checklist: ['Checklist', 'application'],
  expenses: ['Fees', 'application'],
  portal: ['Portal', 'application'],
  requirements: ['Requirements', 'profile'],
  admission: ['Admission requirements', 'profile'],
  tuition: ['Tuition', 'profile'],
  tuition_usd_per_year: ['Tuition (USD)', 'profile'],
  living_usd_per_year: ['Living costs', 'profile'],
  funding: ['Funding note', 'funding'],
  overview: ['Overview', 'profile'],
  format: ['Format', 'profile'],
  duration: ['Length', 'profile'],
  structure: ['Structure', 'profile'],
  courses: ['Courses', 'profile'],
  sop_prompt: ['Essay prompt', 'overview'],
  intake: ['Intake', 'profile'],
  degree: ['Degree', 'profile'],
  city: ['City', 'profile'],
  url: ['Official page', 'profile'],
  outcomes: ['Outcomes', 'profile'],
  coverage: ['Coverage', 'profile'],
  eligibility: ['Eligibility', 'profile'],
  selection: ['Selection', 'profile'],
  awards_per_year: ['Awards a year', 'profile'],
  provider: ['Provider', 'profile'],
  essays: ['Statements', 'overview'],
}

const EXAMPLES = ['Add the application fee', 'Is the GRE required for international applicants?', 'Add the IELTS and TOEFL minimums', 'When do decisions usually come out?']

/**
 * Ask Claude one specific thing about this application. It researches only that, and changes only the fields it needs.
 * In Apply (`apply`), changed fields open Apply's own pages and agents aren't pointed at Agent Town.
 */
export default function AskClaude({ app, apply }: { app: Application; apply?: boolean }) {
  const { runJob, runningJob, meta } = useData()
  const [q, setQ] = useState('')
  const [showAll, setShowAll] = useState(false)
  const busy = runningJob('ask', app.id)
  const asks = app.asks ?? []
  const latest = asks[0]

  const send = (e?: React.FormEvent) => {
    e?.preventDefault()
    const question = q.trim()
    if (!question || busy) return
    runJob((strong) => api.ask(app.id, question, strong))
      .then(() => setQ(''))
      .catch(() => undefined)
  }

  return (
    <section className="mb-8" aria-label="Ask Claude">
      <form onSubmit={send} className="flex flex-col gap-2 rounded-lg border border-line-strong bg-panel p-2 sm:flex-row sm:items-center">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask Claude to find or add one thing, e.g. the IELTS minimum"
          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-base outline-none placeholder:text-muted"
          disabled={!meta?.ai_configured}
          aria-label="Ask Claude"
        />
        <div className="flex items-center gap-2 px-1 pb-1 sm:pb-0">
          <Button type="submit" disabled={!meta?.ai_configured || !q.trim() || !!busy} loading={!!busy} className="ml-auto sm:ml-0">
            {busy ? 'Asking' : 'Ask'}
          </Button>
        </div>
      </form>

      {!q && !busy && asks.length === 0 && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" onClick={() => setQ(ex)} className="rounded-full px-3 py-1 text-sm text-muted ring-1 ring-line hover:text-text hover:ring-line-strong">
              {ex}
            </button>
          ))}
        </div>
      )}

      {busy && (
        <div className="mt-3 flex items-center gap-3 text-sm">
          <Spinner className="text-live" />
          <span className="min-w-0 truncate">
            <span className="text-text">{busy.agent}</span>
            <span className="text-muted"> is on it: {busy.activity?.[busy.activity.length - 1]?.text ?? (busy.status === 'waiting' ? 'waiting for a free slot' : 'starting')}</span>
          </span>
          {!apply && (
            <Link to="/town" className="shrink-0 text-live hover:underline">
              Follow in Agent Town
            </Link>
          )}
        </div>
      )}

      {/* In Apply the last answer stays folded so the page stays calm; click it to read. */}
      {latest && <Answer entry={latest} app={app} apply={apply} compact={apply} />}
      {asks.length > 1 && (
        <div className="mt-2">
          <button onClick={() => setShowAll((s) => !s)} className="text-sm text-live hover:underline">
            {showAll ? 'Hide earlier questions' : `Earlier questions (${asks.length - 1})`}
          </button>
          {showAll && (
            <div className="mt-1 divide-y divide-line">
              {asks.slice(1).map((a) => (
                <Answer key={a.at + a.question} entry={a} app={app} apply={apply} compact />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/** Where a changed field shows: Research's tabs, or in Apply the program page (profile, funding) or the to-dos. */
function fieldLink(app: Application, tab: string | undefined, apply?: boolean) {
  if (!apply) return `/app/${app.id}${tab && tab !== 'overview' ? `?tab=${tab}` : ''}`
  if (tab === 'profile' || tab === 'funding') return `${applyPath(app)}&page=program${tab === 'funding' ? '&tab=funding' : ''}`
  return applyPath(app)
}

function Answer({ entry, app, compact, apply }: { entry: AskEntry; app: Application; compact?: boolean; apply?: boolean }) {
  const [open, setOpen] = useState(!compact)
  return (
    <article className={cx('mt-3', compact && 'mt-0 py-3')}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-baseline gap-3 text-left" aria-expanded={open}>
        <span className="min-w-0 flex-1 font-medium">{entry.question}</span>
        <span className="num shrink-0 text-xs text-muted">{formatDate(entry.at.slice(0, 10))}</span>
      </button>
      {open && (
        <div className="mt-2 border-l-2 border-line-strong pl-4">
          <div className="max-w-[80ch] text-sm">
            <Markdown>{entry.answer}</Markdown>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            {entry.changed.length ? (
              <>
                <span className="text-muted">Changed</span>
                {entry.changed.map((f) => (
                  <Link key={f} to={fieldLink(app, FIELD[f]?.[1], apply)} className="hover:opacity-80">
                    <Tag tone="blue">{FIELD[f]?.[0] ?? f}</Tag>
                  </Link>
                ))}
              </>
            ) : (
              <span className="text-muted">No changes made</span>
            )}
            {entry.sources.slice(0, 3).map((s) => (
              <ExternalLink key={s} href={s} className="max-w-[18rem] text-sm">
                {s.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40)}
              </ExternalLink>
            ))}
          </div>
        </div>
      )}
    </article>
  )
}
