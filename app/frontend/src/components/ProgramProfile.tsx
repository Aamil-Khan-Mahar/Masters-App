import type { ReactNode } from 'react'
import { api, type Application } from '../api'
import { useData } from '../data'
import { useReadOnly } from '../readOnly'
import { countdown, cx, formatDate, splitLabel, urgencyClass } from '../lib'
import { Badge, Button, Markdown, Spinner } from './ui'

/** Read-only profile of a program or scholarship, built from Claude's research. */
export default function ProgramProfile({ app }: { app: Application; onShowFaculty?: () => void }) {
  const { runJob, runningJob, meta } = useData()
  const ro = useReadOnly()
  const busy = runningJob('research', app.id)
  // Just this section (the Researcher); the header's button sends the whole team.
  const research = () => runJob((strong) => api.research(app.id, strong)).catch(() => undefined)
  const hasProfile = !!(app.overview || app.admission?.gpa || app.faculty_profiles?.length || app.selection?.length)

  if (!hasProfile)
    return (
      <div className="rounded-lg border border-dashed border-line-strong/70 px-8 py-14 text-center">
        <p className="font-display text-xl">{busy ? 'Researching this ' + app.kind + '…' : 'No profile yet'}</p>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-muted">
          {busy
            ? 'Claude is reading the official pages: overview, requirements, faculty, labs and funding. This takes a couple of minutes; you can leave this page.'
            : app.researched_on
              ? 'This was researched before profiles existed. Refresh the research to fill in the description, requirements and faculty.'
              : 'Research it with Claude to fill in the description, requirements, faculty, labs, funding and outcomes.'}
        </p>
        <div className="mt-5">
          {busy ? (
            <Spinner className="text-live" />
          ) : ro ? (
            <span className="text-sm text-muted">Research happens in Research mode.</span>
          ) : (
            <Button variant="primary" onClick={research} disabled={!meta?.ai_configured}>
              {app.researched_on ? 'Research again' : `Research this ${app.kind}`}
            </Button>
          )}
        </div>
      </div>
    )

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-panel px-5 py-3">
        <p className="text-xs text-muted">
          {busy
            ? 'The Researcher is reading the official pages again. You can leave this page.'
            : app.researched_on
              ? `Description, structure, deadlines and careers from official pages, researched ${formatDate(app.researched_on)}.`
              : 'Description, structure, deadlines and careers from official pages.'}
        </p>
        {!ro && (
          <Button size="sm" onClick={research} loading={!!busy} disabled={!meta?.ai_configured || !!busy}>
            {app.researched_on ? 'Research this section again' : 'Research this section'}
          </Button>
        )}
      </div>
      {app.kind === 'program' ? <Program app={app} /> : <Scholarship app={app} />}
    </>
  )
}

function Program({ app }: { app: Application }) {
  const deadlines = app.deadlines.filter((d) => d.date)

  return (
    <div className="grid max-w-[1500px] gap-x-14 gap-y-10 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-10">
        <section>
          {app.format && <div className="mb-2 text-xs text-muted">{app.format}</div>}
          <Prose text={app.overview} />
        </section>

        {(app.structure || app.courses?.length) && (
          <Section title="What you'd study">
            {app.structure && <Prose text={app.structure} />}
            {!!app.courses?.length && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {app.courses.map((c) => (
                  <Badge key={c} className="bg-panel-2 text-text/90 ring-line">
                    {c}
                  </Badge>
                ))}
              </div>
            )}
          </Section>
        )}

        {!!app.labs?.length && (
          <Section title="Labs & groups">
            <ul className="divide-y divide-line border-y border-line">
              {app.labs.map((l) => (
                <li key={l.name} className="px-5 py-3.5">
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="font-medium">{l.name}</span>
                    {l.url && (
                      <a href={l.url} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-live hover:underline">
                        Website ↗
                      </a>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm text-muted">{l.focus}</p>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {app.outcomes && (
          <Section title="Careers & outcomes">
            <Prose text={app.outcomes} />
          </Section>
        )}
      </div>

      {/* At-a-glance column */}
      <aside className="space-y-6 lg:sticky lg:top-6 lg:self-start">
        <div className="border-t border-line-strong pt-4">
          <dl className="space-y-4">
            <Fact label="Degree">{app.degree}</Fact>
            <Fact label="Length">{app.duration}</Fact>
            <Fact label="Intake">{app.intake}</Fact>
            <Fact label="Location">{app.city && app.country && app.city.includes(app.country) ? app.city : [app.city, app.country].filter(Boolean).join(', ')}</Fact>
          </dl>
        </div>
        {deadlines.length > 0 && (
          <div className="border-t border-line-strong pt-4">
            <div className="mb-3 text-xs text-muted">Deadlines</div>
            <ul className="space-y-3">
              {deadlines.map((d, i) => (
                <li key={i} title={d.label}>
                  <div className="text-sm font-medium">{splitLabel(d.label).title}</div>
                  {splitLabel(d.label).note && <div className="line-clamp-2 text-xs text-muted">{splitLabel(d.label).note}</div>}
                  <div className="num text-xs">
                    <span className="text-muted">{formatDate(d.date)}</span>
                    {!d.done && <span className={cx('ml-2', urgencyClass(d.date))}>{countdown(d.date)}</span>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Sources app={app} />
      </aside>
    </div>
  )
}

function Scholarship({ app }: { app: Application }) {
  return (
    <div className="grid max-w-[1500px] gap-x-14 gap-y-10 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-10">
        <Prose text={app.overview} />
        <div className="grid gap-10 md:grid-cols-2">
          <Section title="Who can apply">
            <List items={app.eligibility} />
          </Section>
          <Section title="What they look for">
            <List items={app.selection} />
          </Section>
        </div>
        <Section title="How to apply">
          <List items={app.requirements} />
        </Section>
      </div>
      <aside className="space-y-6 lg:sticky lg:top-6 lg:self-start">
        <div className="border-t border-line-strong pt-4">
          <dl className="space-y-4">
            <Fact label="Provider">{app.provider}</Fact>
            <Fact label="Where">{app.country}</Fact>
            <Fact label="Covers">{app.coverage}</Fact>
            <Fact label="Awards">{app.awards_per_year}</Fact>
            <Fact label="Next deadline">
              {app.deadlines[0]?.date && (
                <>
                  {formatDate(app.deadlines[0].date)} <span className={urgencyClass(app.deadlines[0].date)}>{countdown(app.deadlines[0].date)}</span>
                </>
              )}
            </Fact>
          </dl>
        </div>
        <Sources app={app} />
      </aside>
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

function Fact({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm leading-relaxed">{children || <span className="text-muted">Not published</span>}</dd>
    </div>
  )
}

function List({ title, items }: { title?: string; items?: string[] }) {
  return (
    <div>
      {title && <div className="mb-2 text-xs text-muted">{title}</div>}
      {items?.length ? (
        <ul className="space-y-1.5 text-sm leading-relaxed">
          {items.map((x, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="mt-[0.55rem] h-1 w-1 shrink-0 rounded-full bg-muted" />
              <span>{x}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Not published</p>
      )}
    </div>
  )
}

function Prose({ text }: { text?: string }) {
  if (!text) return null
  return (
    <div className="max-w-[72ch] text-base leading-[1.7] text-text/90">
      <Markdown>{text}</Markdown>
    </div>
  )
}

function Sources({ app }: { app: Application }) {
  if (!app.sources.length) return null
  return (
    <div className="px-1">
      <div className="mb-2 text-xs text-muted">Sources{app.researched_on && `, researched ${formatDate(app.researched_on)}`}</div>
      <ul className="space-y-1 text-xs break-all">
        {app.sources.slice(0, 8).map((s) => (
          <li key={s}>
            <a href={s} target="_blank" rel="noreferrer" className="text-live hover:underline">
              {s.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}
