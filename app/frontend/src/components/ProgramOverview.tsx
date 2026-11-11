import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { applyPath } from '../applyTasks'
import { api, type Application } from '../api'
import { useData } from '../data'
import { countdown, cx, daysUntil, formatDate, money, splitLabel, urgencyClass, weightedScore } from '../lib'
import { Button, Chevron, Markdown, Tag, TierBadge } from './ui'

type Go = (tab: string) => void

interface Step {
  key: string
  title: ReactNode
  detail?: ReactNode
  when?: string // ISO date, sorts and colours the step
  action?: ReactNode
}

/** First tab of an application: what to do next, then the few facts that matter most. */
export default function ProgramOverview({ app, go }: { app: Application; go: Go }) {
  const { profile, runJob, runMission, runningJob, busyApp, update, meta } = useData()
  const navigate = useNavigate()
  const isProgram = app.kind === 'program'
  const ai = !!meta?.ai_configured
  const steps: Step[] = []

  // --- research gaps first: everything else depends on them
  if (!app.researched_on)
    steps.push({
      key: 'research',
      title: `Research this ${app.kind}`,
      detail: 'Fills in the description, requirements, deadlines and fees.',
      action: <AiButton label="Send research team" kind="research" app={app} start={() => runMission(app.id)} />,
    })
  if (isProgram && app.researched_on && !app.funding_researched_on)
    steps.push({
      key: 'funding',
      title: 'Work out how you would pay for it',
      detail: 'Find the funding package, awards and what you would have to cover yourself.',
      action: <AiButton label="Research funding" kind="funding" app={app} start={() => runJob((strong) => api.researchFunding(app.id, strong))} />,
    })
  if (isProgram && app.faculty_source_url && !app.faculty_researched_on)
    steps.push({
      key: 'faculty',
      title: 'Get the full faculty list',
      detail: 'Read the supervisor directory and match everyone against your interests.',
      action: <AiButton label="Fetch faculty" kind="faculty" app={app} start={() => runJob((strong) => api.fetchFaculty(app.id, app.faculty_source_url!, strong))} />,
    })

  if (isProgram && app.researched_on && !app.course_check?.checked_on)
    steps.push({
      key: 'courses',
      title: 'Check your courses against the requirements',
      detail: 'Match your courses, topic by topic, with the official degree, subject-area and credit requirements.',
      action: <AiButton label="Check my courses" kind="course-check" app={app} start={() => runJob((strong) => api.courseCheck(app.id, strong))} />,
    })
  const rc = app.requirements_check
  if (isProgram && app.researched_on && !rc?.checked_on)
    steps.push({
      key: 'requirements',
      title: 'Build the entry-requirements checklist',
      detail: 'Every official rule quoted from the admission page, statutes and annexes, checked against you, with how to meet each.',
      action: <AiButton label="Build the checklist" kind="requirements" app={app} start={() => runJob((strong) => api.buildRequirements(app.id, strong))} />,
    })
  const verdict = app.course_check?.verdict
  if (isProgram && verdict && (verdict === 'at risk' || verdict === 'not eligible'))
    steps.push({
      key: 'course-gaps',
      title: verdict === 'not eligible' ? 'Your courses may not meet the requirements' : 'Your courses only partly meet the requirements',
      detail: app.course_check?.gaps?.[0] ?? 'See what is missing on the program page.',
      action: <Button size="sm" onClick={() => go('profile')}>See the check</Button>,
    })

  // --- deadlines
  app.deadlines
    .filter((d) => d.date && !d.done && daysUntil(d.date) >= 0)
    .forEach((d, i) => {
      const { title, note } = splitLabel(d.label || 'Deadline')
      steps.push({ key: `dl-${i}`, title: `${title} due`, when: d.date, detail: [formatDate(d.date), note].filter(Boolean).join('. ') })
    })

  // --- once it's shortlisted, the next step is to start applying (essays, letters and fees live in Apply)
  if (app.stage === 'shortlisted')
    steps.push({
      key: 'apply',
      title: 'Ready to apply?',
      detail: 'Start applying moves it to Apply, where its essays, letters, documents and fees live.',
      action: <Button size="sm" variant="primary" onClick={() => update(app.id, { stage: 'preparing' }).then(() => navigate(applyPath(app)))}>Start applying</Button>,
    })

  // Dated steps first by date, then the rest in the order above.
  const ordered = [...steps.filter((s) => s.when).sort((a, b) => a.when!.localeCompare(b.when!)), ...steps.filter((s) => !s.when)]

  const total = weightedScore(app, profile?.shortlist_weights ?? { fit: 35, cost: 25, admit: 20, career: 20 })
  const cost = (app.tuition_usd_per_year ?? 0) + (app.living_usd_per_year ?? 0)
  const pkg = app.funding_details?.typical_package_usd_per_year ?? 0
  const ad = app.admission ?? {}
  const strong = (app.faculty_profiles ?? []).filter((f) => f.match === 'strong')

  return (
    <div className="grid gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_340px] 3xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0 space-y-10">
        <section>
          <h2 className="mb-4 border-b border-line pb-2 font-display text-xl">What to do next</h2>
          {ordered.length === 0 ? (
            <p className="text-sm text-muted">Nothing outstanding.</p>
          ) : (
            <ol className="divide-y divide-line border-y border-line">
              {ordered.map((s, i) => (
                <li key={s.key} className="flex flex-wrap items-start gap-x-4 gap-y-2 py-4 sm:flex-nowrap">
                  <span className="num mt-0.5 w-5 shrink-0 text-right text-sm text-muted">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-base font-medium">{s.title}</div>
                    {s.detail && (
                      <div className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted" title={typeof s.detail === 'string' ? s.detail : undefined}>
                        {s.detail}
                      </div>
                    )}
                  </div>
                  {s.when && <span className={cx('num shrink-0 text-sm font-medium', urgencyClass(s.when))}>{countdown(s.when)}</span>}
                  {s.action && <div className="shrink-0 pl-9 sm:pl-0">{s.action}</div>}
                </li>
              ))}
            </ol>
          )}

        </section>

        {(app.overview || app.coverage) && (
          <section>
            <h2 className="mb-3 border-b border-line pb-2 font-display text-xl">In short</h2>
            <div className="line-clamp-6 max-w-[75ch] text-[0.95rem] leading-[1.7] text-text/90">
              <Markdown>{(app.overview || app.coverage || '').split('\n\n')[0]}</Markdown>
            </div>
            <button onClick={() => go('profile')} className="mt-2 text-sm text-live hover:underline">
              Read the full {isProgram ? 'program' : 'scholarship'} page
            </button>
          </section>
        )}
      </div>

      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        {isProgram && (
          <Tile title="Fit" onClick={() => go('profile')}>
            {total !== null ? (
              <div className="flex items-baseline gap-3">
                <span className="num font-display text-4xl">{total}</span>
                <span className="text-sm text-muted">of 10</span>
                <TierBadge tier={app.scores?.tier} />
              </div>
            ) : (
              <AiButton label="Score fit" kind="score" app={app} start={() => runJob((strong) => api.score(app.id, strong))} />
            )}
          </Tile>
        )}
        {isProgram && (cost > 0 || pkg > 0) && (
          <Tile title="Money, per year" onClick={() => go('funding')}>
            <dl className="num grid grid-cols-3 gap-2 text-sm">
              <div>
                <dt className="text-xs text-muted">Cost</dt>
                <dd>{cost ? money(cost) : '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Funding</dt>
                <dd className="text-ok">{pkg ? money(pkg) : '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Gap</dt>
                <dd className="text-warn">{cost ? money(Math.max(0, cost - pkg)) : '—'}</dd>
              </div>
            </dl>
          </Tile>
        )}
        {isProgram && rc?.items ? (
          <Tile title="Entry requirements checklist" onClick={() => go('requirements')}>
            <div className="flex flex-wrap items-center gap-2">
              <Tag family="eligibility" value={rc.verdict} />
              {(['not met', 'maybe', 'unclear'] as const).filter((s) => rc.counts[s]).map((s) => (
                <Tag key={s} family="req" value={s}>{rc.counts[s]} {s}</Tag>
              ))}
            </div>
            <p className="num mt-1.5 text-sm text-muted">{rc.done} of {rc.items} ticked off</p>
          </Tile>
        ) : null}
        {isProgram && (ad.gpa || ad.english) && (
          <Tile title="Entry requirements" onClick={() => go('profile')}>
            <ul className="space-y-2 text-sm leading-snug">
              {ad.gpa && <li><span className="text-muted">Grades: </span>{ad.gpa}</li>}
              {ad.english && <li><span className="text-muted">English: </span>{ad.english.split('.')[0]}</li>}
              {ad.gre && <li><span className="text-muted">GRE: </span>{ad.gre}</li>}
              {ad.letters && <li><span className="text-muted">Letters: </span>{ad.letters}</li>}
            </ul>
          </Tile>
        )}
        {isProgram && verdict && (
          <Tile title="Your courses" onClick={() => go('profile')}>
            <div className="flex items-center gap-3">
              <Tag family="eligibility" value={verdict} />
              <span className="num text-sm text-muted">
                {(app.course_check?.requirements ?? []).filter((r) => r.status === 'met').length} of {(app.course_check?.requirements ?? []).length} requirements met
              </span>
            </div>
          </Tile>
        )}
        {isProgram && !!app.faculty_profiles?.length && (
          <Tile title="Faculty" onClick={() => go('faculty')}>
            <p className="text-sm">
              <span className="num text-t-green">{strong.length}</span> strong matches of {app.faculty_profiles.length}
            </p>
            <p className="mt-1 truncate text-sm text-muted">{strong.slice(0, 3).map((f) => f.name).join(', ')}</p>
          </Tile>
        )}
        {busyApp(app.id) && (
          <Link to="/town" className="block px-1 text-sm text-live hover:underline">
            Agents are working on this. Follow them in Agent Town.
          </Link>
        )}
      </aside>
    </div>
  )

  function AiButton({ label, kind, app, start }: { label: string; kind: string; app: Application; start: () => Promise<unknown> }) {
    const busy = runningJob(kind, app.id)
    return (
      <Button size="sm" variant="primary" loading={!!busy} disabled={!ai || !!busy} onClick={() => start().catch(() => undefined)}>
        {busy ? 'Working…' : label}
      </Button>
    )
  }
}

function Tile({ title, children, onClick }: { title: string; children: ReactNode; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="group block w-full rounded-lg border border-line bg-panel p-4 text-left hover:border-line-strong">
      <div className="mb-2 flex items-center justify-between text-sm text-muted">
        {title}
        <Chevron className="group-hover:text-live" />
      </div>
      {children}
    </button>
  )
}
