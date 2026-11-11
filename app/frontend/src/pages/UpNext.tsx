import { Link } from 'react-router-dom'
import { useData } from '../data'
import { allDeadlines, countdown, cx, daysUntil, formatDate, shortDate, shortName, splitLabel, testEvents, urgencyClass, type DeadlineEvent, type TestEvent } from '../lib'
import { applyPath, GROUPS, inApply, isSubmitted, mainDeadline, progress, shortLabel, tasksFor } from '../applyTasks'
import { ApplyPage } from '../components/ApplyLayout'
import { Row, Section, Tag } from '../components/ui'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
/** Countdown for a sentence: "in 65 days", "tomorrow", "in 4 months". */
const inWords = (iso: string) => {
  const n = daysUntil(iso)
  return n <= 0 ? 'today' : n === 1 ? 'tomorrow' : n <= 120 ? `in ${n} days` : `in ${Math.round(n / 30)} months`
}

/** Apply mode's first page: what closes next, the one next step for each application, and what's due soon. */
export default function UpNext() {
  const { apps, recommenders, profile, meta, loading } = useData()
  if (loading) return <ApplyPage><p className="text-sm text-muted">Loading…</p></ApplyPage>

  const applying = apps.filter(inApply)
  const open = applying.filter((a) => !isSubmitted(a)).sort((a, b) => (mainDeadline(a)?.date ?? '9999').localeCompare(mainDeadline(b)?.date ?? '9999'))
  const deadlines = allDeadlines(applying).filter((e) => !/open|portal|start/i.test(shortLabel(e.label)))
  const next = deadlines[0]

  // The first open to-do of each application, in the order the to-do list shows them.
  const steps = open.flatMap((a) => {
    const tasks = tasksFor(a, profile, recommenders).filter((t) => !t.done)
    const first = GROUPS.flatMap((g) => tasks.filter((t) => t.group === g))[0]
    const [done, total] = progress(tasksFor(a, profile, recommenders))
    return first ? [{ a, t: first, left: total - done }] : []
  })

  // Dated things in the next 30 days: deadlines, booked tests, scores about to expire.
  const soon = [
    ...deadlines.map((e) => ({ key: `${e.app.id}-${e.date}-${e.label}`, date: e.date, title: shortLabel(e.label), who: shortName(e.app), to: applyPath(e.app), tag: 'Deadline' })),
    ...testEvents(profile?.tests).map((e) => ({ key: `t-${e.title}-${e.date}`, date: e.date, title: e.label, who: e.kind === 'test' ? 'Booked test' : 'Check validity', to: '/you/tests', tag: e.kind === 'test' ? 'Test' : 'Expiry' })),
  ]
    .filter((e) => daysUntil(e.date) <= 30)
    .sort((x, y) => x.date.localeCompare(y.date))

  return (
    <ApplyPage>
      <section className="mb-8 md:mb-10">
        <div className="text-sm text-muted">{meta && new Date(meta.today + 'T00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
        <h1 className="mt-2 max-w-[24ch] font-display text-[2.4rem] leading-[1.02] md:text-[3.25rem] 3xl:text-[4rem]">
          {next ? `${shortName(next.app)} is due ${inWords(next.date)}.` : applying.length ? 'Nothing due yet.' : 'Nothing to apply to yet.'}
        </h1>
        <p className="mt-3 text-base text-muted">
          {next && `${shortLabel(next.label)}, ${formatDate(next.date)}. `}
          {applying.length
            ? `${plural(open.length, 'application')} in progress${applying.length > open.length ? `, ${applying.length - open.length} submitted` : ''}.`
            : 'Open a shortlisted program in Research mode and press Start applying.'}
        </p>
      </section>

      <Season events={deadlines} tests={testEvents(profile?.tests)} intake={profile?.target_intake} />

      <div className="mt-10 grid items-start gap-x-14 gap-y-10 lg:grid-cols-2">
        <Section title="Next for each" count={steps.length}>
          {steps.length === 0 ? (
            <p className="py-3 text-sm text-muted">Nothing open. Everything in progress is done or submitted.</p>
          ) : (
            <ul className="divide-y divide-line">
              {steps.map(({ a, t, left }) => {
                const d = mainDeadline(a)
                return (
                  <li key={a.id}>
                    <Row
                      to={applyPath(a, t.key)}
                      lead={d ? <div className={cx('num text-sm font-medium', urgencyClass(d.date))}>{countdown(d.date)}</div> : <span className="text-sm text-muted">No date</span>}
                      title={t.title}
                      meta={`${shortName(a)}, ${t.status.toLowerCase()}`}
                      trail={<span className="num text-xs text-muted">{left} left</span>}
                    />
                  </li>
                )
              })}
            </ul>
          )}
        </Section>

        <Section title="Due in the next 30 days" count={soon.length}>
          {soon.length === 0 ? (
            <p className="py-3 text-sm text-muted">Nothing dated in the next month.</p>
          ) : (
            <ul className="divide-y divide-line">
              {soon.map((e) => (
                <li key={e.key}>
                  <Row
                    to={e.to}
                    lead={
                      <div>
                        <div className={cx('num text-sm font-medium', urgencyClass(e.date))}>{countdown(e.date)}</div>
                        <div className="num text-xs text-muted">{shortDate(e.date)}</div>
                      </div>
                    }
                    title={e.title}
                    meta={e.who}
                    trail={<Tag tone={e.tag === 'Deadline' ? 'red' : e.tag === 'Test' ? 'teal' : 'orange'}>{e.tag}</Tag>}
                  />
                </li>
              ))}
            </ul>
          )}
          <Link to="/apply/calendar" className="mt-3 inline-block text-sm text-live hover:underline">
            Whole calendar
          </Link>
        </Section>
      </div>
    </ApplyPage>
  )
}

/** "Fall 2027" -> 1 Sep 2027 (Winter -> Jan, Spring/Summer -> May). Falls back to a year from now. */
function intakeDate(intake?: string): Date {
  const m = intake?.match(/(fall|autumn|winter|spring|summer)?\s*(\d{4})/i)
  if (!m) {
    const d = new Date()
    return new Date(d.getFullYear() + 1, 8, 1)
  }
  const season = (m[1] ?? 'fall').toLowerCase()
  const month = season === 'winter' ? 0 : season === 'spring' || season === 'summer' ? 4 : 8
  return new Date(Number(m[2]), month, 1)
}

/**
 * The season map: every month from now to the intake, deadlines pinned by date.
 * Pins take the urgency colours (red within two weeks, yellow within a month); today is the yellow rule.
 */
function Season({ events, tests, intake }: { events: DeadlineEvent[]; tests: TestEvent[]; intake?: string }) {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  let end = intakeDate(intake)
  const last = events.length ? new Date(events[events.length - 1].date + 'T00:00') : null
  // One list of pins: application deadlines open the application in Apply, test dates open Tests.
  const all = [
    ...events.map((e) => ({ date: e.date, name: shortName(e.app), what: splitLabel(e.label).title, to: applyPath(e.app) })),
    ...tests.map((e) => ({ date: e.date, name: e.kind === 'test' ? e.title : `${e.title} expires`, what: e.label, to: '/you/tests' })),
  ].sort((a, b) => a.date.localeCompare(b.date))
  if (last && last >= end) end = new Date(last.getFullYear(), last.getMonth() + 2, 1)
  const span = end.getTime() - start.getTime()
  const at = (d: Date) => ((d.getTime() - start.getTime()) / span) * 100

  const months: Date[] = []
  for (let d = new Date(start); d < end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.push(d)

  // Vertical labels, one narrow column each: pins on the same or nearby dates sit side by side,
  // nudged right just enough not to touch, while the dot stays on the true date.
  const gap = 2.1 // label column width, % of the 860px minimum
  let prev = -Infinity
  const pins = all.filter((e) => new Date(e.date + 'T00:00') < end).slice(0, 24).map((e) => {
    const x = at(new Date(e.date + 'T00:00'))
    const lx = Math.max(x, prev + gap)
    prev = lx
    return { e, x, lx }
  })
  const longest = Math.max(0, ...pins.map(({ e }) => Math.min(e.name.length, 26) + String(daysUntil(e.date)).length + 3))
  const height = Math.min(240, Math.max(110, longest * 8 + 36))

  return (
    <section aria-label="Season from today to the intake" className="-mx-4 md:mx-0">
      <div className="overflow-x-auto px-4 pb-2 md:px-0">
        <div className="relative min-w-[860px]">
          <div className="relative" style={{ height }}>
            {pins.map(({ e, x, lx }, i) => {
              const tone = urgencyClass(e.date)
              const dot = tone === 'text-danger' ? 'bg-danger' : tone === 'text-accent' ? 'bg-accent' : 'bg-white'
              return (
                <Link key={`${e.to}-${e.date}-${i}`} to={e.to} className="group" title={`${e.name}: ${e.what} (${formatDate(e.date)})`}>
                  <span className="absolute bottom-0 h-3 w-px bg-line-strong group-hover:bg-live" style={{ left: `${x}%` }} />
                  <span className={cx('absolute bottom-2.5 h-2 w-2 -translate-x-1/2 rounded-full', dot)} style={{ left: `${x}%` }} />
                  <span
                    className="absolute bottom-6 flex -translate-x-1/2 rotate-180 items-baseline gap-2 text-sm leading-4 whitespace-nowrap [writing-mode:vertical-rl]"
                    style={{ left: `${lx}%` }}
                  >
                    <span className="max-h-[208px] truncate text-text group-hover:text-live">{e.name}</span>
                    <span className={cx('num', tone)}>{daysUntil(e.date)}d</span>
                  </span>
                </Link>
              )
            })}
          </div>

          <div className="relative flex border-t border-line-strong">
            {months.map((m, i) => (
              <div key={i} className="border-l border-line pt-2.5 pl-2.5" style={{ width: `${(100 * (new Date(m.getFullYear(), m.getMonth() + 1, 1).getTime() - m.getTime())) / span}%` }}>
                <div className="font-display text-[1.6rem] leading-none 3xl:text-[1.9rem]">{m.toLocaleDateString(undefined, { month: 'short' })}</div>
                {(i === 0 || m.getMonth() === 0) && <div className="num mt-1 text-xs text-muted">{m.getFullYear()}</div>}
              </div>
            ))}
            <div className="absolute -top-px right-0 h-[calc(100%+1px)] border-r-2 border-white" title="Intake" />
          </div>

          <div className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-accent" style={{ left: `${at(now)}%` }} aria-hidden />
          <div className="mt-3 flex justify-between text-sm">
            <span className="text-accent" style={{ marginLeft: `${at(now)}%` }}>
              Today
            </span>
            <span>{intake ? `${intake} intake` : 'Intake'}</span>
          </div>
        </div>
      </div>
    </section>
  )
}
