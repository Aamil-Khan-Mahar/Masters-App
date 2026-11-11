import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, type Application, type Stage, type Deadline } from '../api'
import { useData } from '../data'
import { appPath, countdown, cx, formatDate, fullName, shortDate, isFresh, money, nextDeadline, STAGES, urgencyClass } from '../lib'
import FacultyDirectory from '../components/FacultyDirectory'
import FundingTab from '../components/FundingTab'
import ProgramProfile from '../components/ProgramProfile'
import ProgramOverview from '../components/ProgramOverview'
import ProgramTabs, { programTab } from '../components/ProgramTabs'
import { NotesView } from '../components/ApplicationView'
import OpusToggle from '../components/OpusToggle'
import AskClaude from '../components/AskClaude'
import { applyPath, inApply } from '../applyTasks'
import { Button, Card, EditableText, Empty, ExternalLink, Input, Label, Markdown, Menu, Select, StageBadge, Tabs, Tag, Textarea, TierBadge } from '../components/ui'

type ViewTab = 'overview' | 'profile' | 'requirements' | 'faculty' | 'funding' | 'notes'
type EditTab = 'details' | 'tasks' | 'contacts' | 'notes'

export default function ApplicationPage() {
  const id = useParams()['*'] ?? ''
  const { apps, loading, update } = useData()
  const app = apps.find((a) => a.id === id)
  // The open tab lives in the URL (?tab=funding) so any tab can be linked to directly.
  const [params, setParams] = useSearchParams()
  // Once a program is being applied to, its to-dos live in Apply mode; here it keeps only the research.
  const applying = !!app && inApply(app)
  const first: ViewTab = applying ? 'profile' : 'overview'
  const allowed: ViewTab[] = applying ? ['profile', 'requirements', 'faculty', 'funding', 'notes'] : ['overview', 'profile', 'requirements', 'faculty', 'funding', 'notes']
  const tab = (allowed.includes(params.get('tab') as ViewTab) ? params.get('tab') : first) as ViewTab
  const setTab = (t: ViewTab) => setParams(t === first ? {} : { tab: t }, { replace: true })
  const pTab = programTab(params.get('tab'))
  const [editTab, setEditTab] = useState<EditTab | null>(null)

  if (loading) return <p className="pt-10 text-sm text-muted">Loading…</p>
  if (!app)
    return (
      <Empty title="Not found" action={<Link to="/applications" className="text-live hover:underline">Back to applications</Link>}>
        No application at {id}
      </Empty>
    )

  const isProgram = app.kind === 'program'
  // Links inside views can jump to another view, or straight into an edit form ("edit:people").
  const go = (t: string) => (t.startsWith('edit:') ? setEditTab(t.slice(5) as EditTab) : setTab(t as ViewTab))

  return (
    <>
      <Header app={app} editing={editTab !== null} onToggleEdit={() => setEditTab((e) => (e ? null : 'details'))} />
      {app.kind !== 'program' && <Facts app={app} />}
      {applying && editTab === null && (
        <p className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 border-l-2 border-live pl-4 text-sm text-muted">
          You're applying to this one. Essays, letters, documents, fees and submitting are in Apply.
          <Link to={applyPath(app)} className="text-live hover:underline">
            Open in Apply
          </Link>
        </p>
      )}
      {editTab === null && <AskClaude app={app} />}

      {editTab === null && isProgram ? (
        <ProgramTabs app={app} tab={pTab} onTab={(t) => setParams(t === 'details' ? {} : { tab: t }, { replace: true })} />
      ) : editTab === null ? (
        <>
          <Tabs<ViewTab>
            value={tab}
            onChange={setTab}
            tabs={[
              ...(applying ? [] : [{ id: 'overview' as ViewTab, label: 'Overview' }]),
              { id: 'profile', label: isProgram ? 'Program' : 'Scholarship' },
              ...(isProgram
                ? [
                    { id: 'faculty' as ViewTab, label: `Faculty${app.faculty_profiles?.length ? ` (${app.faculty_profiles.length})` : ''}` },
                    { id: 'funding' as ViewTab, label: 'Funding' },
                  ]
                : []),
              { id: 'notes', label: 'Notes' },
            ]}
          />
          {tab === 'overview' && <ProgramOverview app={app} go={go} />}
          {tab === 'profile' && <ProgramProfile app={app} onShowFaculty={() => setTab('faculty')} />}
          {tab === 'faculty' && <FacultyDirectory app={app} onEditSource={() => setEditTab('contacts')} />}
          {tab === 'funding' && <FundingTab app={app} />}
          {tab === 'notes' && <NotesView app={app} onEdit={() => setEditTab('notes')} />}
        </>
      ) : (
        <div className="rounded-lg border border-accent/40 p-4 sm:p-6">
          <div className="mb-1 flex items-center justify-between gap-4">
            <Tabs<EditTab>
              value={editTab}
              onChange={setEditTab}
              tabs={[
                { id: 'details', label: 'Details & status' },
                { id: 'tasks', label: 'Deadlines' },
                ...(isProgram ? [{ id: 'contacts' as EditTab, label: 'Faculty directory' }] : [{ id: 'notes' as EditTab, label: 'Notes' }]),
              ]}
            />
          </div>
          {editTab === 'details' && <DetailsEdit app={app} />}
          {editTab === 'tasks' && <Tasks app={app} />}
          {editTab === 'contacts' && (
            <div className="space-y-6">
              <Card title="Faculty directory link">
                <EditableText
                  value={app.faculty_source_url}
                  onSave={(v) => update(app.id, { faculty_source_url: v.trim() })}
                  placeholder="https://… the program's potential supervisors page"
                />
                <p className="mt-2 text-xs text-muted">Used by “Get names from page” on the Faculty tab.</p>
              </Card>
            </div>
          )}
          {editTab === 'notes' && <Notes app={app} />}
        </div>
      )}
    </>
  )
}

function Header({ app, editing, onToggleEdit }: { app: Application; editing: boolean; onToggleEdit: () => void }) {
  const { update, runJob, runMission, runningJob, busyApp, removeApp, toast, meta } = useData()
  const navigate = useNavigate()
  // Jobs are tracked app-wide (and the result applied there), so this survives leaving the page.
  const team = busyApp(app.id)
  const scoring = runningJob('score', app.id)
  const fresh = isFresh(app.researched_on)
  const research = () => runMission(app.id, { force: fresh }).catch(() => undefined)
  const score = () => runJob((strong) => api.score(app.id, strong)).catch(() => undefined)
  const isProgram = app.kind === 'program'
  const back = isProgram ? '/applications' : '/scholarships'

  const del = async () => {
    if (!confirm(`Delete "${app.name}" and its whole folder (README, SOP, notes)? This can't be undone in the app.`)) return
    await api.remove(app.id)
    removeApp(app.id)
    toast(`Deleted ${app.name}`)
    navigate(back)
  }

  return (
    <header className="mb-6 md:mb-8">
      <Link to={back} className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-text">
        <span aria-hidden>‹</span> {isProgram ? 'Applications' : 'Scholarships'}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-x-10 gap-y-5">
        <div className="min-w-0 max-w-[60rem]">
          <h1 className="font-display text-[2rem] leading-[1.05] md:text-[2.75rem] 3xl:text-[3.1rem]">{fullName(app)}</h1>
          {isProgram && <p className="mt-2 text-lg leading-snug text-text/85">{app.name}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <StageBadge stage={app.stage} track />
            <TierBadge tier={app.scores?.tier} />
            {app.kind === 'scholarship' && <Tag family="kind" value="scholarship" />}
            {app.decision && <Tag family="decision" value={app.decision} />}
            {[app.city, app.country].filter(Boolean).length > 0 && <span className="text-muted">{[app.city, app.country].filter(Boolean).join(', ')}</span>}
            {app.url && <ExternalLink href={app.url}>Official page</ExternalLink>}
            {app.researched_on && <span className="text-muted">Researched {formatDate(app.researched_on)}</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {inApply(app) ? (
            <Link to={applyPath(app)} className="inline-flex h-9 items-center rounded-md px-3.5 text-sm font-medium text-live ring-1 ring-live/40 hover:bg-live/10">
              Open in Apply
            </Link>
          ) : (
            app.stage === 'shortlisted' && (
              <button
                onClick={() => update(app.id, { stage: 'preparing' }).then(() => navigate(applyPath(app)))}
                className="inline-flex h-9 items-center rounded-md px-3.5 text-sm font-medium text-live ring-1 ring-live/40 hover:bg-live/10"
                title="Moves it to Preparing. Essays, letters, documents and fees then live in Apply."
              >
                Start applying
              </button>
            )
          )}
          {/* Programs change stage from their tab bar (ProgramTabs). */}
          {!isProgram && (
            <select
              value={app.stage}
              onChange={(e) => update(app.id, { stage: e.target.value as Stage })}
              className="h-9 rounded-md border border-line-strong bg-bg px-2.5 text-sm"
              aria-label="Stage"
              title="Move to another stage"
            >
              {STAGES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          )}
          <Button variant={editing ? 'primary' : 'subtle'} onClick={onToggleEdit}>
            {editing ? 'Done editing' : 'Edit'}
          </Button>
          <OpusToggle className="h-9" />
          <Button
            variant={app.researched_on ? 'subtle' : 'primary'}
            onClick={research}
            loading={!!team && !scoring}
            disabled={!meta?.ai_configured || !!team}
            title={
              fresh
                ? 'Researched in the last 30 days. This sends the whole team again: program, funding and faculty names, then a fit score.'
                : 'Researches every section at once: program, funding and faculty names in parallel, then a fit score. Each tab also has its own button.'
            }
          >
            {team && !scoring ? 'Team out researching' : fresh ? 'Research again' : 'Research'}
          </Button>
          <Menu
            items={[
              ...(isProgram ? [{ label: scoring ? 'Scoring…' : 'Score fit with Claude', onClick: score, disabled: !meta?.ai_configured || !!team || !!scoring }] : []),
              ...(app.url ? [{ label: 'Open official page', onClick: () => window.open(app.url, '_blank', 'noreferrer') }] : []),
              ...(app.portal?.url ? [{ label: 'Open application portal', onClick: () => window.open(app.portal.url, '_blank', 'noreferrer') }] : []),
              { label: app.archived ? 'Consider again' : 'Not considering', onClick: () => update(app.id, { archived: !app.archived }) },
              { label: 'Delete application', onClick: del, danger: true },
            ]}
          />
        </div>
      </div>
    </header>
  )
}

// ------------------------------------------------------------------ overview

function DetailsEdit({ app }: { app: Application }) {
  const { update, apps } = useData()
  const save = (k: keyof Application) => (v: string) => update(app.id, { [k]: v } as Partial<Application>)
  const num = (k: keyof Application) => (v: string) => update(app.id, { [k]: v === '' ? null : Number(v) } as Partial<Application>)
  const isProgram = app.kind === 'program'
  const linkKey = isProgram ? 'scholarships' : 'programs'
  const linked = (app[linkKey] as string[] | undefined) ?? []
  const linkable = apps.filter((a) => a.kind !== app.kind && !linked.includes(a.id))

  const fields: [keyof Application, string, 'text' | 'num'][] = isProgram
    ? [
        ['name', 'Program', 'text'],
        ['university', 'University', 'text'],
        ['country', 'Country', 'text'],
        ['city', 'City', 'text'],
        ['degree', 'Degree', 'text'],
        ['intake', 'Intake', 'text'],
        ['duration', 'Duration', 'text'],
        ['url', 'Official page', 'text'],
        ['tuition', 'Tuition (as published)', 'text'],
        ['tuition_usd_per_year', 'Tuition USD / year', 'num'],
        ['living_usd_per_year', 'Living USD / year', 'num'],
      ]
    : [
        ['name', 'Scholarship', 'text'],
        ['provider', 'Provider', 'text'],
        ['country', 'Host country', 'text'],
        ['url', 'Official page', 'text'],
        ['coverage', 'Coverage', 'text'],
      ]

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card title="Details" className="lg:col-span-2">
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map(([k, label, t]) => (
            <div key={k}>
              <Label>{label}</Label>
              <EditableText value={app[k] as string | number | null} type={t === 'num' ? 'number' : 'text'} onSave={t === 'num' ? num(k) : save(k)} />
            </div>
          ))}
        </div>
        {isProgram && (
          <div className="mt-4">
            <Label>Funding</Label>
            <EditableText multiline value={app.funding} onSave={save('funding')} placeholder="TA/RA positions, stipends, named awards…" />
          </div>
        )}
      </Card>

      <div className="space-y-5">
        <Card title="Status">
          <div className="space-y-3">
            <div>
              <Label>Stage</Label>
              <Select value={app.stage} onChange={(e) => update(app.id, { stage: e.target.value as Application['stage'] })}>
                {STAGES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Decision</Label>
              <Select value={app.decision ?? ''} onChange={(e) => update(app.id, { decision: (e.target.value || null) as Application['decision'] })}>
                <option value="">Pending</option>
                <option value="admitted">Admitted</option>
                <option value="waitlisted">Waitlisted</option>
                <option value="rejected">Rejected</option>
              </Select>
            </div>
            <div>
              <Label>My response</Label>
              <Select value={app.response ?? ''} onChange={(e) => update(app.id, { response: (e.target.value || null) as Application['response'] })}>
                <option value="">—</option>
                <option value="accepted">Accepted</option>
                <option value="declined">Declined</option>
              </Select>
            </div>
          </div>
        </Card>

        {isProgram && app.scores && typeof app.scores.fit === 'number' && (
          <Card title={<span className="flex items-center gap-2">Fit scores <TierBadge tier={app.scores.tier} /></span>}>
            <div className="mb-3 grid grid-cols-4 gap-2 text-center">
              {(['fit', 'cost', 'admit', 'career'] as const).map((k) => (
                <div key={k} className="rounded-lg bg-panel-2 py-2">
                  <div className="text-lg font-semibold tabular-nums">{app.scores?.[k]}</div>
                  <div className="text-[0.7rem] text-muted">{k}</div>
                </div>
              ))}
            </div>
            {app.scores.rationale && <Markdown>{app.scores.rationale}</Markdown>}
          </Card>
        )}

        <Card title={isProgram ? 'Linked scholarships' : 'Programs it could fund'}>
          <ul className="mb-3 space-y-1.5 text-sm">
            {linked.length === 0 && <li className="text-muted">None linked.</li>}
            {linked.map((lid) => {
              const other = apps.find((a) => a.id === lid)
              return (
                <li key={lid} className="flex items-center justify-between gap-2">
                  <Link to={appPath(lid)} className="truncate hover:text-live">
                    {other ? (other.kind === 'program' ? `${other.university} — ${other.name}` : other.name) : lid}
                  </Link>
                  <button className="text-xs text-muted hover:text-danger" onClick={() => update(app.id, { [linkKey]: linked.filter((x) => x !== lid) })}>
                    remove
                  </button>
                </li>
              )
            })}
          </ul>
          {linkable.length > 0 && (
            <Select value="" onChange={(e) => e.target.value && update(app.id, { [linkKey]: [...linked, e.target.value] })}>
              <option value="">+ Link {isProgram ? 'a scholarship' : 'a program'}…</option>
              {linkable.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.kind === 'program' ? `${a.university} — ${a.name}` : a.name}
                </option>
              ))}
            </Select>
          )}
        </Card>
      </div>

      <Card title={isProgram ? 'Requirements' : 'Eligibility & requirements'} className="lg:col-span-3">
        <div className={cx('grid gap-6', !isProgram && 'md:grid-cols-2')}>
          {!isProgram && <StringList label="Eligibility" items={app.eligibility ?? []} onChange={(v) => update(app.id, { eligibility: v })} />}
          <StringList label={isProgram ? undefined : 'To apply'} items={app.requirements} onChange={(v) => update(app.id, { requirements: v })} />
        </div>
      </Card>
    </div>
  )
}

function StringList({ items, onChange, label }: { items: string[]; onChange: (v: string[]) => void; label?: string }) {
  const [draft, setDraft] = useState('')
  return (
    <div>
      {label && <Label>{label}</Label>}
      {items.length === 0 && <p className="mb-2 text-sm text-muted">Nothing yet — add items or run research.</p>}
      <ul className="mb-2 space-y-1">
        {items.map((r, i) => (
          <li key={i} className="group flex items-start gap-2 text-sm">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted" />
            <span className="flex-1">{r}</span>
            <button className="text-xs text-muted opacity-0 group-hover:opacity-100 hover:text-danger" onClick={() => onChange(items.filter((_, j) => j !== i))}>
              remove
            </button>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (draft.trim()) onChange([...items, draft.trim()])
          setDraft('')
        }}
      >
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add an item and press Enter" />
      </form>
    </div>
  )
}

// ------------------------------------------------------------------ checklist & deadlines

function Tasks({ app }: { app: Application }) {
  const { update } = useData()
  const [dl, setDl] = useState<Deadline>({ label: '', date: '' })

  const setDeadlines = (d: Deadline[]) => update(app.id, { deadlines: [...d].sort((a, b) => (a.date || '').localeCompare(b.date || '')) })

  return (
    <div className="max-w-3xl">
      <Card title="Deadlines">
        {app.deadlines.length === 0 && <p className="mb-3 text-sm text-muted">No deadlines yet. Run research or add one below.</p>}
        <ul className="mb-4 divide-y divide-line">
          {app.deadlines.map((d, i) => (
            <li key={i} className="group flex items-center gap-3 py-2">
              <input
                type="checkbox"
                title="Mark done"
                checked={!!d.done}
                onChange={() => setDeadlines(app.deadlines.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))}
                className="h-4 w-4 cursor-pointer accent-[var(--color-accent)]"
              />
              <div className="min-w-0 flex-1">
                <div className={cx('text-sm', d.done && 'text-muted line-through')}>{d.label || 'Deadline'}</div>
                <div className="text-xs text-muted">{formatDate(d.date)}</div>
              </div>
              {d.date && !d.done && <span className={cx('text-xs font-medium', urgencyClass(d.date))}>{countdown(d.date)}</span>}
              <button className="text-xs text-muted opacity-0 group-hover:opacity-100 hover:text-danger" onClick={() => setDeadlines(app.deadlines.filter((_, j) => j !== i))}>
                remove
              </button>
            </li>
          ))}
        </ul>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!dl.date) return
            setDeadlines([...app.deadlines, { label: dl.label || 'Deadline', date: dl.date }])
            setDl({ label: '', date: '' })
          }}
        >
          <Input value={dl.label} onChange={(e) => setDl({ ...dl, label: e.target.value })} placeholder="Label (e.g. Application)" />
          <Input type="date" value={dl.date} onChange={(e) => setDl({ ...dl, date: e.target.value })} className="w-44" required />
          <Button type="submit">Add</Button>
        </form>
      </Card>
    </div>
  )
}

// ------------------------------------------------------------------ recommenders & faculty

function Notes({ app }: { app: Application }) {
  const { update } = useData()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(app.body)

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card
        title="README.md"
        className="lg:col-span-2"
        actions={
          editing ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => (setEditing(false), setDraft(app.body))}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" onClick={() => update(app.id, { body: draft }).then(() => setEditing(false))}>
                Save
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => (setDraft(app.body), setEditing(true))}>
              Edit
            </Button>
          )
        }
      >
        {editing ? <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={24} className="font-mono text-xs" /> : <Markdown>{app.body || '_Empty_'}</Markdown>}
      </Card>
      <Card title="Sources">
        {app.sources.length === 0 ? (
          <p className="text-sm text-muted">Sources appear here after research.</p>
        ) : (
          <ul className="space-y-1.5 text-xs break-all">
            {app.sources.map((s, i) => (
              <li key={i}>
                <a href={s} target="_blank" rel="noreferrer" className="text-live hover:underline">
                  {s}
                </a>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-xs text-muted">
          Stored at <code>Applications/{app.id}/README.md</code>
        </p>
      </Card>
    </div>
  )
}

/** The handful of numbers you check most, in one line. */
function Facts({ app }: { app: Application }) {
  const nd = nextDeadline(app)
  const fee = app.expenses.find((e) => /^application fee/i.test(e.label))
  const items: [string, React.ReactNode][] = [
    ['Next deadline', nd ? <><span className={cx('font-medium', urgencyClass(nd.date))}>{countdown(nd.date)}</span><span className="text-muted">, {shortDate(nd.date)}</span></> : <span className="text-muted">Not set</span>],
  ]
  if (app.kind === 'program') {
    items.push(['Tuition a year', app.tuition_usd_per_year ? money(app.tuition_usd_per_year) : <span className="text-muted">Unknown</span>])
    items.push(['Application fee', fee?.amount != null ? money(fee.amount, fee.currency) : <span className="text-muted">Unknown</span>])
  } else {
    items.push(['Coverage', <span className="line-clamp-1">{app.coverage || <span className="text-muted">Unknown</span>}</span>])
  }
  return (
    <dl className="mb-8 grid grid-cols-2 gap-x-8 gap-y-4 border-y border-line py-4 sm:grid-cols-3">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-sm text-muted">{k}</dt>
          <dd className="num mt-0.5 truncate text-base">{v}</dd>
        </div>
      ))}
    </dl>
  )
}
