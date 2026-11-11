import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api, type Application, type FundingAward } from '../api'
import { useData } from '../data'
import { useReadOnly } from '../readOnly'
import { appPath, cx, formatDate, money } from '../lib'
import { Button, Markdown, Spinner, Tag } from './ui'

const HOW: Record<FundingAward['how'], { label: string; tone: string }> = {
  automatic: { label: 'Automatic', tone: 'bg-ok/10 text-ok ring-ok/25' },
  nomination: { label: 'Nominated', tone: 'bg-info/10 text-info ring-info/25' },
  application: { label: 'Apply separately', tone: 'bg-warn/10 text-warn ring-warn/25' },
}
const GUARANTEED: Record<string, string> = {
  yes: 'Funding is guaranteed for admitted students',
  partial: 'Some admitted students are funded',
  no: 'No guaranteed funding',
  unknown: 'Funding guarantee not published',
}

/** How a program is paid for: package, awards, assistantships, and what's left for the applicant to cover. */
export default function FundingTab({ app }: { app: Application }) {
  const { apps, runJob, runningJob, replaceApp, update, profile, meta, toast } = useData()
  const busy = runningJob('funding', app.id)
  const ro = useReadOnly()
  const fd = app.funding_details ?? {}
  const researched = !!app.funding_researched_on
  const run = () => runJob((strong) => api.researchFunding(app.id, strong)).catch(() => undefined)

  // Rough yearly picture in USD. Only counts what we have numbers for.
  const cost = (app.tuition_usd_per_year ?? 0) + (app.living_usd_per_year ?? 0)
  const pkg = fd.typical_package_usd_per_year ?? 0
  const gap = cost ? Math.max(0, cost - pkg) : null
  const budget = profile?.budget_usd_per_year ?? null

  const linked = (app.scholarships ?? []).map((id) => apps.find((a) => a.id === id)).filter(Boolean) as Application[]
  const tracked = (name: string) => apps.find((a) => a.kind === 'scholarship' && a.name.toLowerCase() === name.toLowerCase())

  const trackAward = async (name: string, provider: string, url: string, coverage: string) => {
    try {
      const s = await api.create({ kind: 'scholarship', name, provider, country: app.country, url })
      const withLink = await api.update(s.id, { coverage, programs: [app.id] })
      replaceApp(withLink)
      await update(app.id, { scholarships: [...(app.scholarships ?? []), s.id] })
      toast(`Tracking ${name} under Scholarships`)
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  if (!researched)
    return (
      <div className="rounded-lg border border-dashed border-line-strong/70 px-8 py-14 text-center">
        <p className="font-display text-xl">{busy ? 'Researching funding…' : 'How would you pay for this?'}</p>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-muted">
          {busy
            ? 'Claude is reading the program, faculty and graduate-studies funding pages. Usually 2–4 minutes; you can leave this page.'
            : 'Claude finds the typical funding package, every internal award and fee waiver you could get, assistantships, and external scholarships, then works out what would be left for you to cover.'}
        </p>
        {app.funding && !busy && <p className="mx-auto mt-4 max-w-xl text-left text-sm leading-relaxed text-text/80">{app.funding}</p>}
        <div className="mt-5">
          {busy ? (
            <Spinner className="text-live" />
          ) : ro ? (
            <span className="text-sm text-muted">Research happens in Research mode.</span>
          ) : (
            <Button variant="primary" onClick={run} disabled={!meta?.ai_configured}>
              Research funding
            </Button>
          )}
        </div>
      </div>
    )

  return (
    <div className="space-y-10">
      {/* The answer first: what it costs, what typically comes back, what's left. */}
      <section className="grid gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div className="bg-panel p-5">
          <div className={cx('text-xs', fd.guaranteed === 'yes' ? 'text-ok' : fd.guaranteed === 'no' ? 'text-warn' : 'text-muted')}>{GUARANTEED[fd.guaranteed ?? 'unknown']}</div>
          <p className="mt-2 text-sm leading-relaxed text-text/90">{fd.summary}</p>
        </div>
        <Figure label="Cost per year" value={cost ? money(cost) : '—'} hint="tuition + living" />
        <Figure label="Typical package" value={pkg ? money(pkg) : '—'} hint={fd.typical_package ? 'see below' : 'not published'} tone="text-ok" />
        <Figure
          label="Left to cover"
          value={gap === null ? '—' : money(gap)}
          hint={budget && gap !== null ? (gap <= budget ? `within your ${money(budget)} budget` : `over your ${money(budget)} budget`) : profile?.funding_need === 'full' ? 'you need full funding' : undefined}
          tone={gap === null ? undefined : gap === 0 ? 'text-ok' : 'text-warn'}
        />
      </section>

      {fd.typical_package && (
        <Section title="Typical package">
          <Prose text={fd.typical_package} />
        </Section>
      )}

      <Section title="Awards & fee waivers" aside={`${fd.awards?.length ?? 0} found`}>
        {fd.awards?.length ? (
          <ul className="divide-y divide-line border-y border-line">
            {fd.awards.map((a) => {
              const t = tracked(a.name)
              return (
                <li key={a.name} className="grid gap-x-6 gap-y-2 px-5 py-4 md:grid-cols-[1fr_auto]">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-[1.1rem]">{a.name}</span>
                      <Tag family="how" value={a.how}>{HOW[a.how].label}</Tag>
                    </div>
                    <div className="num mt-1 text-sm font-medium">{a.amount || 'Amount not published'}</div>
                    <p className="mt-1.5 max-w-[80ch] text-sm leading-relaxed text-text/80">{a.eligibility}</p>
                    {a.deadline && <p className="mt-1 text-xs text-warn">Deadline: {a.deadline}</p>}
                  </div>
                  <div className="flex items-start gap-3 md:flex-col md:items-end">
                    {a.url && (
                      <a href={a.url} target="_blank" rel="noreferrer" className="text-xs text-live hover:underline">
                        Details ↗
                      </a>
                    )}
                    {a.how !== 'automatic' &&
                      (t ? (
                        <Link to={appPath(t)} className="text-xs text-ok">
                          Tracking
                        </Link>
                      ) : (
                        ro ? null : <Button size="sm" onClick={() => trackAward(a.name, app.university ?? '', a.url, a.amount)}>
                          Track as scholarship
                        </Button>
                      ))}
                  </div>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted">No internal awards found for international master's students.</p>
        )}
      </Section>

      {fd.assistantships && (
        <Section title="Teaching & research assistantships">
          <Prose text={fd.assistantships} />
        </Section>
      )}

      <Section title="External scholarships" aside="Apply on your own">
        {fd.external?.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {fd.external.map((x) => {
              const t = tracked(x.name)
              return (
                <article key={x.name} className="flex flex-col rounded-lg border border-line bg-panel p-4">
                  <h3 className="font-display text-[1.1rem] leading-snug">{x.name}</h3>
                  <p className="text-xs text-muted">{x.provider}</p>
                  {x.amount && <p className="num mt-2 text-sm font-medium">{x.amount}</p>}
                  <p className="mt-1.5 text-sm leading-relaxed text-text/80">{x.eligibility}</p>
                  <div className="mt-auto flex items-center justify-between gap-3 pt-3">
                    {x.url ? (
                      <a href={x.url} target="_blank" rel="noreferrer" className="text-xs text-live hover:underline">
                        Details ↗
                      </a>
                    ) : (
                      <span />
                    )}
                    {t ? (
                      <Link to={appPath(t)} className="text-xs text-ok">
                        Tracking
                      </Link>
                    ) : (
                      ro ? null : <Button size="sm" onClick={() => trackAward(x.name, x.provider, x.url, x.amount)}>
                        Track as scholarship
                      </Button>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        ) : (
          <p className="text-sm text-muted">None found.</p>
        )}
        {linked.length > 0 && (
          <div className="mt-5">
            <div className="mb-2 text-xs text-muted">Scholarships you're tracking for this program</div>
            <div className="flex flex-wrap gap-2">
              {linked.map((s) => (
                <Link key={s.id} to={appPath(s)} className="rounded-full bg-panel-2 px-3 py-1 text-xs ring-1 ring-line hover:text-live">
                  {s.name}
                </Link>
              ))}
            </div>
          </div>
        )}
      </Section>

      {fd.notes && (
        <div className="rounded-lg border border-warn/25 bg-warn/5 px-5 py-4">
          <Markdown>{fd.notes}</Markdown>
        </div>
      )}

      <div className="flex items-center justify-between gap-4 border-t border-line pt-4 text-xs text-muted">
        <span>Researched {formatDate(app.funding_researched_on)}. Amounts are converted roughly to USD; check the official pages.</span>
        {!ro && (
          <Button size="sm" variant="ghost" onClick={run} loading={!!busy} disabled={!meta?.ai_configured || !!busy}>
            Refresh funding
          </Button>
        )}
      </div>
    </div>
  )
}

function Figure({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="bg-panel p-5">
      <div className="text-xs text-muted">{label}</div>
      <div className={cx('num mt-2 text-2xl', tone ?? 'text-text')}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  )
}

function Section({ title, aside, children }: { title: string; aside?: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-4 flex items-baseline justify-between gap-3 border-b border-line pb-2">
        <h2 className="font-display text-xl">{title}</h2>
        {aside && <span className="text-xs text-muted">{aside}</span>}
      </div>
      {children}
    </section>
  )
}

function Prose({ text }: { text: string }) {
  return (
    <div className="max-w-[78ch] text-[0.95rem] leading-[1.7] text-text/90">
      <Markdown>{text}</Markdown>
    </div>
  )
}
