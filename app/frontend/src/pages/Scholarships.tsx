import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { Application } from '../api'
import { useData } from '../data'
import { appPath, countdown, cx, nextDeadline, shortDate, shortName, splitLabel, urgencyClass } from '../lib'
import { inApply } from '../applyTasks'
import NewApplication from '../components/NewApplication'
import { Button, Chevron, Empty, PageHeader, StageBadge, Tag } from '../components/ui'

/** External funding you're tracking, soonest deadline first. */
export default function Scholarships() {
  const { apps } = useData()
  const [adding, setAdding] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const all = apps.filter((a) => a.kind === 'scholarship')
  // Ones you're applying to (or done with) live in Apply.
  const applying = all.filter((a) => !a.archived && (inApply(a) || a.stage === 'final')).length
  const list = all
    .filter((a) => a.stage === 'researching' || a.stage === 'shortlisted')
    .filter((a) => showArchived || !a.archived)
    .sort((a, b) => (nextDeadline(a)?.date ?? '9999').localeCompare(nextDeadline(b)?.date ?? '9999'))
  const dated = list.filter((a) => nextDeadline(a))
  const undated = list.filter((a) => !nextDeadline(a))

  return (
    <>
      <PageHeader
        title="Scholarships"
        subtitle="External funding you're tracking. Each one moves through the same stages as programs and can be linked to the programs it would pay for."
        actions={
          <>
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="h-4 w-4 accent-[var(--color-live)]" />
              Include not considering
            </label>
            <Link to="/discover?kind=scholarship">
              <Button>Find scholarships</Button>
            </Link>
            <Button variant="primary" onClick={() => setAdding(true)}>
              Add scholarship
            </Button>
          </>
        }
      />
      {applying > 0 && (
        <p className="mb-8 border-l-2 border-live pl-4 text-sm text-muted">
          You're applying to {applying} scholarship{applying === 1 ? '' : 's'}. They live in Apply now.{' '}
          <Link to="/apply" className="text-live hover:underline">
            Open Apply
          </Link>
        </p>
      )}
      {list.length === 0 ? (
        <Empty
          title={all.length ? 'Only scholarships you are not considering' : 'No scholarships tracked'}
          action={
            <Link to="/discover?kind=scholarship">
              <Button variant="primary">Find scholarships</Button>
            </Link>
          }
        >
          {all.length ? 'Tick Include not considering to see them.' : 'Describe what you need on Discover and Claude will find awards you qualify for, or add one yourself.'}
        </Empty>
      ) : (
        <div className="space-y-12">
          {[
            ['With a deadline', dated],
            ['No deadline yet', undated],
          ].map(([title, rows]) =>
            (rows as Application[]).length ? (
              <section key={title as string}>
                <h2 className="mb-4 font-display text-[1.4rem]">
                  {title as string}
                  <span className="num ml-2 text-base text-muted">{(rows as Application[]).length}</span>
                </h2>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4">
                  {(rows as Application[]).map((s) => (
                    <ScholarshipCard key={s.id} s={s} apps={apps} />
                  ))}
                </div>
              </section>
            ) : null,
          )}
        </div>
      )}
      <NewApplication open={adding} onClose={() => setAdding(false)} kind="scholarship" />
    </>
  )
}

function ScholarshipCard({ s, apps }: { s: Application; apps: Application[] }) {
  const navigate = useNavigate()
  const nd = nextDeadline(s)
  const linked = (s.programs ?? []).map((id) => apps.find((a) => a.id === id)).filter(Boolean) as Application[]
  return (
    <div className={cx('group flex cursor-pointer flex-col rounded-lg border border-line bg-panel p-5 hover:border-line-strong', s.archived && 'opacity-55')} onClick={() => navigate(appPath(s))}>
      <h3 className="font-display text-[1.25rem] leading-tight group-hover:text-live">{s.name}</h3>
      <p className="mt-1 truncate text-sm text-muted">{[s.provider, s.country].filter(Boolean).join(', ') || 'Provider unknown'}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <StageBadge stage={s.stage} />
        {s.decision && <Tag family="decision" value={s.decision} />}
        {s.archived && <Tag tone="grey">Not considering</Tag>}
      </div>
      <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-text/85">{s.coverage || <span className="text-accent">Coverage unknown. Open it to research.</span>}</p>
      {s.eligibility?.length ? <p className="mt-2 line-clamp-2 text-sm text-muted">{s.eligibility.slice(0, 2).join('. ')}</p> : null}
      {linked.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-sm">
          <span className="text-muted">Funds</span>
          {linked.slice(0, 3).map((p) => (
            <Link key={p.id} to={appPath(p)} onClick={(e) => e.stopPropagation()} className="hover:opacity-80">
              <Tag family="kind" value="program">
                {shortName(p)}
              </Tag>
            </Link>
          ))}
          {linked.length > 3 && <span className="text-muted">and {linked.length - 3} more</span>}
        </div>
      )}
      <div className="mt-auto flex items-center gap-3 border-t border-line pt-3 text-sm">
        {nd ? (
          <span className="min-w-0 truncate" title={nd.label}>
            <span className={cx('num font-medium', urgencyClass(nd.date))}>{countdown(nd.date)}</span>
            <span className="text-muted">
              , {shortDate(nd.date)}, {splitLabel(nd.label).title.toLowerCase()}
            </span>
          </span>
        ) : (
          <span className="text-muted">No deadline yet</span>
        )}
        <Link to={appPath(s)} className="ml-auto flex shrink-0 items-center gap-0.5 text-live opacity-80 group-hover:opacity-100">
          Open
          <Chevron />
        </Link>
      </div>
    </div>
  )
}
