import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, type Course, type Courses as CoursesData } from '../api'
import { useData } from '../data'
import { appPath, formatDate } from '../lib'
import { Empty, ExternalLink, Input, Markdown, PageHeader, Row, Section, Select, Spinner, Stat, Tag } from '../components/ui'

/** Everything you studied, from Common/Course-Outlines/Courses.md, and how it measures up against each program. */
export default function Courses() {
  const { apps } = useData()
  const [data, setData] = useState<CoursesData | null>(null)
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [dept, setDept] = useState('')
  useEffect(() => {
    api.courses().then(setData).catch(() => setData({ exists: false, path: 'Course-Outlines/Courses.md', intro: '', areas: [], courses: [] }))
  }, [])

  const selected = params.get('course')
  const q = query.trim().toLowerCase()
  const matches = useMemo(() => {
    const list = (data?.courses ?? []).filter((c) => !dept || c.department === dept)
    if (!q) return list.map((c) => ({ course: c, hit: '' }))
    return list
      .map((c) => {
        const hay = [c.code, c.title, ...c.topics, ...c.outcomes, c.description]
        const hit = hay.find((h) => h.toLowerCase().includes(q))
        return hit ? { course: c, hit: [c.code, c.title].includes(hit) ? '' : hit } : null
      })
      .filter((x): x is { course: Course; hit: string } => !!x)
  }, [data, dept, q])

  if (!data)
    return (
      <div className="py-20 text-center">
        <Spinner className="text-live" />
      </div>
    )
  if (!data.exists || !data.courses.length)
    return (
      <>
        <PageHeader title="Courses" />
        <Empty title="No courses yet">
          Add <span className="num">Common/{data.path}</span>: a summary table, then one "### CODE: Title" section per course with its facts, outcomes and topics.
        </Empty>
      </>
    )

  const course = selected ? data.courses.find((c) => c.code === selected) : undefined
  if (course) return <CourseDetail course={course} onBack={() => setParams({})} />

  const depts = [...new Set(data.courses.map((c) => c.department))]
  const withOutline = data.courses.filter((c) => c.has_outline).length
  const programs = apps.filter((a) => a.kind === 'program' && !a.archived)
  const checked = programs.filter((a) => a.course_check?.checked_on)

  return (
    <>
      <PageHeader
        title="Courses"
        subtitle={`Everything you studied, from your course outlines. Updated ${formatDate(data.modified)} in Common/${data.path}.`}
      />
      <div className="mb-10 grid grid-cols-2 divide-line border-y border-line sm:grid-cols-3 lg:grid-cols-6 lg:divide-x">
        <Stat label="Courses" value={data.courses.length} />
        <Stat label="With an outline" value={withOutline} />
        {data.areas.map((a) => (
          <Stat key={a.name} label={a.name} value={a.ects.toFixed(1)} hint="ECTS" />
        ))}
      </div>

      <Section title="Against your programs" count={checked.length} aside={<span className="text-muted">Checked against official requirements</span>}>
        {checked.length === 0 ? (
          <p className="py-3 text-sm text-muted">No program checked yet. Open a program and use Check my courses, or send its research team.</p>
        ) : (
          <div className="divide-y divide-line">
            {checked.map((a) => {
              const reqs = a.course_check?.requirements ?? []
              return (
                <Row
                  key={a.id}
                  to={`${appPath(a)}?tab=profile`}
                  title={a.name}
                  meta={`${a.university ?? ''}, ${reqs.filter((r) => r.status === 'met').length} of ${reqs.length} requirements met, checked ${formatDate(a.course_check?.checked_on)}`}
                  tags={<Tag family="eligibility" value={a.course_check?.verdict} />}
                />
              )
            })}
          </div>
        )}
        {programs.length > checked.length && (
          <p className="pt-2 pb-1 text-xs text-muted">{programs.length - checked.length} programs not checked yet.</p>
        )}
      </Section>

      <div className="mt-10 mb-2 flex flex-wrap items-center gap-3">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search topics, e.g. Bayes, eigenvalues, TCP" className="w-full max-w-md" />
        <div className="w-60">
          <Select value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="">All departments</option>
            {depts.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </Select>
        </div>
        {q && <span className="num text-sm text-muted">{matches.length} courses cover it</span>}
      </div>

      {depts
        .filter((d) => matches.some((m) => m.course.department === d))
        .map((d) => {
          const rows = matches.filter((m) => m.course.department === d)
          return (
            <Section key={d} title={d} count={rows.length} className="mt-6">
              <div className="divide-y divide-line">
                {rows.map(({ course: c, hit }) => (
                  <Row
                    key={c.code}
                    to={`?course=${encodeURIComponent(c.code)}`}
                    lead={<span className="num text-sm">{c.code}</span>}
                    title={c.title}
                    meta={hit || [c.semester_taken, c.credits].filter(Boolean).join(', ')}
                    tags={!c.has_outline ? <Tag tone="grey">No outline</Tag> : undefined}
                    trail={<span className="num text-sm">{c.grade}</span>}
                  />
                ))}
              </div>
            </Section>
          )
        })}
      {matches.length === 0 && <p className="py-6 text-sm text-muted">No course mentions that.</p>}
    </>
  )
}

function CourseDetail({ course: c, onBack }: { course: Course; onBack: () => void }) {
  const facts = c.facts.filter((f) => f.label.toLowerCase() !== 'outline')
  return (
    <>
      <button onClick={onBack} className="mb-4 text-sm text-muted hover:text-text">
        <span aria-hidden>‹ </span>All courses
      </button>
      <PageHeader title={`${c.code}: ${c.title}`} subtitle={c.department} />
      <div className="grid max-w-[1500px] gap-x-14 gap-y-10 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-8">
          {c.description && (
            <div className="max-w-[72ch] text-base leading-[1.7] text-text/90">
              <Markdown>{c.description}</Markdown>
            </div>
          )}
          {!c.has_outline && <p className="text-sm text-muted">{c.note || 'No outline yet.'}</p>}
          <List title="Learning outcomes" items={c.outcomes} />
          <List title="Topics and concepts" items={c.topics} />
          <List title="Texts" items={c.texts} />
        </div>
        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <dl className="divide-y divide-line border-y border-line">
            {[...facts, ...c.fields].map((f) => (
              <div key={f.label} className="py-2.5">
                <dt className="text-xs text-muted">{f.label}</dt>
                <dd className="mt-0.5 text-sm leading-relaxed">{f.value}</dd>
              </div>
            ))}
          </dl>
          {c.outline_path && (
            <ExternalLink href={api.fileUrl(c.outline_path)} className="text-sm">
              Open the course outline
            </ExternalLink>
          )}
          <Link to="/you/files" className="block text-sm text-muted hover:text-text">
            All your files
          </Link>
        </aside>
      </div>
    </>
  )
}

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null
  return (
    <section>
      <h2 className="mb-3 border-b border-line pb-2 font-display text-xl">{title}</h2>
      <ul className="space-y-1.5 text-[0.95rem] leading-relaxed">
        {items.map((x, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="mt-[0.6rem] h-1 w-1 shrink-0 rounded-full bg-muted" />
            <span>{x}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
