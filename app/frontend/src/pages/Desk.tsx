import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Application, type SavedSearch } from '../api'
import { useData } from '../data'
import { allDeadlines, appPath, countdown, cx, daysUntil, formatDate, isFresh, shortDate, shortName, splitLabel, urgencyClass } from '../lib'
import { inApply } from '../applyTasks'
import { Button, Row, Section, Tag, TierBadge } from '../components/ui'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
/** Programs and scholarships still being decided on: the only things Research mode works with. */
const deciding = (a: Application) => !a.archived && (a.stage === 'researching' || a.stage === 'shortlisted')

/** Research mode's first page: what still needs researching, what has gone stale, and what's waiting on a decision. */
export default function Desk() {
  const { apps, profile, meta, loading } = useData()
  const [searches, setSearches] = useState<SavedSearch[]>([])
  useEffect(() => {
    api.discoverHistory().then(setSearches).catch(() => undefined)
  }, [])
  if (loading) return <p className="pt-10 text-sm text-muted">Loading…</p>

  const list = apps.filter(deciding)
  const shortlist = list.filter((a) => a.stage === 'shortlisted').sort((a, b) => (a.scores?.fit ?? 0) < (b.scores?.fit ?? 0) ? 1 : -1)
  const unresearched = list.filter((a) => !a.researched_on)
  const stale = list.filter((a) => a.researched_on && !isFresh(a.researched_on)).sort((a, b) => (a.researched_on ?? '').localeCompare(b.researched_on ?? ''))
  const closing = allDeadlines(list, false, true)
    .filter((e) => daysUntil(e.date) <= 60)
    .slice(0, 8)
  const applying = apps.filter(inApply).length

  return (
    <>
      <section className="mb-10">
        <div className="text-sm text-muted">{meta && new Date(meta.today + 'T00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
        <h1 className="mt-2 max-w-[24ch] font-display text-[2.4rem] leading-[1.02] md:text-[3.25rem] 3xl:text-[4rem]">
          {list.length === 0 ? "Let's build your list." : `${plural(list.length, 'option')} on the table, ${shortlist.length} shortlisted.`}
        </h1>
        <p className="mt-3 max-w-[64ch] text-base text-muted">
          {list.length === 0 ? 'Describe what you want on Discover and Claude will find programs to add.' : 'Research them, compare them, shortlist the good ones, then start applying.'}
          {applying > 0 && (
            <>
              {' '}
              You're applying to {plural(applying, 'program')}.{' '}
              <Link to="/apply/next" className="text-live hover:underline">
                Open Apply
              </Link>
            </>
          )}
        </p>
        {list.length === 0 && (
          <Link to="/discover" className="mt-6 inline-block">
            <Button variant="primary">Find programs</Button>
          </Link>
        )}
      </section>

      {(!profile?.exists || !meta?.ai_configured) && (
        <div className="mb-8 space-y-2">
          {!profile?.exists && (
            <Link to="/you/profile" className="block rounded-md border border-accent/40 px-4 py-3 text-sm text-accent hover:bg-accent/5">
              Set up your profile so research, scoring and the essay coach can tailor their advice.
            </Link>
          )}
          {!meta?.ai_configured && (
            <div className="rounded-md border border-danger/50 px-4 py-3 text-sm">
              AI features are off. Log in to Claude Code (run <code className="font-mono text-xs">claude</code> once in a terminal) or add <code className="font-mono text-xs">ANTHROPIC_API_KEY</code> to <code className="font-mono text-xs">app/.env</code>, then restart.
            </div>
          )}
        </div>
      )}

      <div className="grid items-start gap-x-14 gap-y-10 lg:grid-cols-2 3xl:grid-cols-3">
        <Section title="Shortlist" count={shortlist.length} open={{ to: '/applications?view=compare', label: 'Compare' }}>
          {shortlist.length === 0 ? (
            <p className="py-3 text-sm text-muted">Nothing shortlisted. Compare your programs and shortlist the ones worth applying to.</p>
          ) : (
            <ul className="divide-y divide-line">
              {shortlist.map((a) => (
                <li key={a.id}>
                  <Row to={appPath(a)} title={shortName(a)} meta={a.kind === 'program' ? a.name : a.provider} tags={<TierBadge tier={a.scores?.tier} />} trail={<span className="text-xs text-live">Start applying</span>} />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Needs research" count={unresearched.length}>
          {unresearched.length === 0 ? (
            <p className="py-3 text-sm text-muted">Everything on your list has been researched.</p>
          ) : (
            <ul className="divide-y divide-line">
              {unresearched.map((a) => (
                <li key={a.id}>
                  <Row to={appPath(a)} title={shortName(a)} meta={a.kind === 'program' ? a.name : a.provider} trail={<Tag tone="grey">{a.stage === 'shortlisted' ? 'Shortlisted' : 'New'}</Tag>} />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Closing in the next 60 days" count={closing.length} open={{ to: '/applications?view=board', label: 'Board' }}>
          {closing.length === 0 ? (
            <p className="py-3 text-sm text-muted">No deadlines in the next two months on programs you haven't started.</p>
          ) : (
            <ul className="divide-y divide-line">
              {closing.map((e, i) => (
                <li key={i}>
                  <Row
                    to={appPath(e.app)}
                    lead={
                      <div>
                        <div className={cx('num text-sm font-medium', urgencyClass(e.date))}>{countdown(e.date)}</div>
                        <div className="num text-xs text-muted">{shortDate(e.date)}</div>
                      </div>
                    }
                    title={shortName(e.app)}
                    meta={splitLabel(e.label).title}
                  />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Gone stale" count={stale.length}>
          {stale.length === 0 ? (
            <p className="py-3 text-sm text-muted">All research is under a month old.</p>
          ) : (
            <ul className="divide-y divide-line">
              {stale.slice(0, 10).map((a) => (
                <li key={a.id}>
                  <Row to={appPath(a)} title={shortName(a)} meta={`Researched ${formatDate(a.researched_on)}`} trail={<span className="text-xs text-muted">Research again</span>} />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Recent searches" count={searches.length} open={{ to: '/discover', label: 'Discover' }}>
          {searches.length === 0 ? (
            <p className="py-3 text-sm text-muted">No searches yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {searches.slice(0, 5).map((s, i) => (
                <li key={i}>
                  <Row to={s.kind === 'scholarship' ? '/discover?kind=scholarship' : '/discover'} title={s.query} meta={`${plural(s.results.length, 'result')}, ${formatDate(s.at.slice(0, 10))}`} />
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  )
}
