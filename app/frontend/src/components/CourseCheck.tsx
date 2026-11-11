import { Link } from 'react-router-dom'
import { api, type Application } from '../api'
import { useData } from '../data'
import { useReadOnly } from '../readOnly'
import { formatDate } from '../lib'
import { Button, ExternalLink, Markdown, Tag } from './ui'

const STATUS_ORDER = { missing: 0, partial: 1, unclear: 2, met: 3 } as const

/** Your courses (Common/Course-Outlines/Courses.md) against this program's official academic requirements. */
export default function CourseCheck({ app }: { app: Application }) {
  const { runJob, runningJob, meta } = useData()
  const ro = useReadOnly()
  const busy = runningJob('course-check', app.id)
  const check = app.course_check ?? {}
  const reqs = [...(check.requirements ?? [])].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status])
  const run = () => runJob((strong) => api.courseCheck(app.id, strong)).catch(() => undefined)
  const button = !ro && (
    <Button size="sm" variant={check.checked_on ? 'subtle' : 'primary'} onClick={run} loading={!!busy} disabled={!meta?.ai_configured || !!busy}>
      {busy ? 'Checking…' : check.checked_on ? 'Check again' : 'Check my courses'}
    </Button>
  )

  if (!check.checked_on)
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-line-strong/70 px-5 py-4">
        <p className="max-w-[70ch] text-sm leading-relaxed text-muted">
          {busy
            ? 'The Assessor is reading the official requirements and statutes, then matching your courses topic by topic.'
            : 'Compare your courses with the official entry requirements: required degree, subject areas, credits and prerequisite topics.'}
        </p>
        {button}
      </div>
    )

  const count = (s: string) => reqs.filter((r) => r.status === s).length
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Tag family="eligibility" value={check.verdict} />
        <span className="num text-sm text-muted">
          {count('met')} met, {count('partial')} partly met, {count('missing')} missing, {count('unclear')} unclear
        </span>
        <span className="text-xs text-muted">Checked {formatDate(check.checked_on)}</span>
        <div className="ml-auto">{button}</div>
      </div>
      {check.summary && (
        <div className="mb-5 max-w-[75ch] text-sm leading-relaxed text-text/90">
          <Markdown>{check.summary}</Markdown>
        </div>
      )}
      <ul className="divide-y divide-line border-y border-line">
        {reqs.map((r, i) => (
          <li key={i} className="grid gap-x-4 gap-y-1.5 py-3.5 sm:grid-cols-[6.5rem_minmax(0,1fr)]">
            <div>
              <Tag family="check" value={r.status}>{r.status === 'partial' ? 'Partly met' : undefined}</Tag>
            </div>
            <div className="min-w-0">
              <div className="text-[0.95rem] leading-snug">{r.requirement}</div>
              {r.note && <p className="mt-1 text-sm leading-relaxed text-muted">{r.note}</p>}
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                {r.evidence.map((code) => (
                  <Link key={code} to={`/you/courses?course=${encodeURIComponent(code)}`} className="num text-live hover:underline">
                    {code}
                  </Link>
                ))}
                {r.ects != null && <span className="num text-muted">{r.ects} ECTS</span>}
                {r.source?.startsWith('http') && (
                  <ExternalLink href={r.source} className="text-xs">
                    Source
                  </ExternalLink>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-6 grid gap-8 sm:grid-cols-2">
        <Bullets title="Gaps" items={check.gaps} />
        <Bullets title="Next steps" items={check.actions} />
      </div>
    </div>
  )
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
