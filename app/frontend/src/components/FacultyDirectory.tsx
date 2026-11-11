import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, isActive, type Application, type FacultyFile, type FacultyProfile } from '../api'
import { useData } from '../data'
import { useReadOnly } from '../readOnly'
import { cx, formatDate } from '../lib'
import OpusToggle from './OpusToggle'
import { Button, ExternalLink, Input, Markdown, Segmented, Spinner, Tag, Textarea } from './ui'

type MatchFilter = 'all' | 'strong' | 'possible' | 'weak' | 'new'
type Bucket = Exclude<MatchFilter, 'all'>
const MATCH_ORDER = { strong: 0, possible: 1, new: 2, weak: 3 } as const
const MATCH_LABEL = { strong: 'Strong match', possible: 'Possible match', weak: 'Less related', new: 'Not researched yet' } as const
// People copied off the directory page have no match until someone researches them.
const researched = (f: FacultyProfile) => !!(f.researched_on || f.match)
const bucket = (f: FacultyProfile): Bucket => (researched(f) ? (f.match ?? 'possible') : 'new')
const byMatch = (a: FacultyProfile, b: FacultyProfile) => MATCH_ORDER[bucket(a)] - MATCH_ORDER[bucket(b)]
// Ranked people first in rank order, then everyone unranked by match.
const byRank = (a: FacultyProfile, b: FacultyProfile) => (a.rank ?? 1e6) - (b.rank ?? 1e6) || byMatch(a, b)

/** Every faculty member Claude found for a program, filterable, with one-click contact tracking. */
export default function FacultyDirectory({ app, onEditSource }: { app: Application; onEditSource?: () => void }) {
  const { runJob, runBatch, runningJob, jobs, meta } = useData()
  const ro = useReadOnly()
  const busy = runningJob('faculty', app.id)
  const researching = jobs.filter((j) => isActive(j) && j.kind === 'faculty-member' && j.params?.app_id === app.id).length
  const url = app.faculty_source_url ?? ''
  const [match, setMatch] = useState<MatchFilter>('all')
  const [dept, setDept] = useState('')
  const [q, setQ] = useState('')
  const [listing, setListing] = useState<'' | 'listed' | 'extra'>('')
  const [group, setGroup] = useState('')
  const [order, setOrder] = useState<'rank' | 'match'>('rank')
  const [extraUrl, setExtraUrl] = useState('')
  // The open person lives in the URL (?tab=faculty&person=Name), so a deep dive can be linked to directly.
  const [params, setParams] = useSearchParams()
  const openName = params.get('person') ?? ''
  const setPerson = (name: string) =>
    setParams((p) => {
      const next = new URLSearchParams(p)
      if (name) next.set('person', name)
      else next.delete('person')
      return next
    })

  const people = app.faculty_profiles ?? []
  const open = people.find((p) => p.name === openName)
  const departments = useMemo(() => [...new Set(people.map((p) => p.department).filter(Boolean))] as string[], [people])
  const groups = useMemo(() => [...new Set([...people].sort(byRank).map((p) => p.group).filter(Boolean))] as string[], [people])
  const isRanked = people.some((p) => p.rank != null)
  const shown = people
    .filter((p) => match === 'all' || bucket(p) === match)
    .filter((p) => !dept || p.department === dept)
    .filter((p) => !group || p.group === group)
    .filter((p) => !listing || (listing === 'extra') === (p.listed === false))
    .filter((p) => !q || `${p.name} ${p.research ?? ''} ${p.title ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    .sort(isRanked && order === 'rank' ? byRank : byMatch)
  const counts = { strong: 0, possible: 0, weak: 0, new: 0 }
  people.forEach((p) => counts[bucket(p)]++)

  const unlisted = people.filter((p) => p.listed === false).length
  const extraPages = app.faculty_extra_urls ?? []
  const fetchList = () => runJob((strong) => api.fetchFaculty(app.id, url, strong)).catch(() => undefined)
  const addFromPage = () => {
    runJob((strong) => api.fetchFaculty(app.id, extraUrl.trim(), strong, true)).catch(() => undefined)
    setExtraUrl('')
  }
  const researchAll = () =>
    runBatch((strong) => api.researchAllFaculty(app.id, strong), `faculty at ${app.university || app.name}`).catch(() => undefined)

  if (open) return <FacultyDeepDive app={app} f={open} onBack={() => setPerson('')} />

  return (
    <div>
      {/* Source: the program's own supervisor/faculty directory */}
      {!ro && (
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-line bg-panel px-5 py-4">
        <div className="min-w-0">
          <div className="text-xs text-muted">Source</div>
          {url ? (
            <a href={url} target="_blank" rel="noreferrer" className="block truncate text-sm text-live hover:underline">
              {url.replace(/^https?:\/\/(www\.)?/, '')} ↗
            </a>
          ) : (
            <button onClick={onEditSource} className="text-sm text-muted hover:text-live">
              No directory link yet. Add the program's supervisor page
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {url && (
            <Button
              variant={people.length && app.faculty_researched_on ? 'subtle' : 'primary'}
              onClick={fetchList}
              loading={!!busy}
              disabled={!meta?.ai_configured || !url.startsWith('http') || !!busy}
              title="Copies the names off the supervisors page. Doesn't open anyone's profile."
            >
              {people.length && app.faculty_researched_on ? 'Refresh names' : 'Get names from page'}
            </Button>
          )}
          {people.length > 0 && (
            <Button
              variant="primary"
              onClick={researchAll}
              loading={researching > 0}
              disabled={!meta?.ai_configured || counts.new === 0 || researching > 0}
              title="One agent per person not researched yet. They take turns, a few at a time."
            >
              {researching ? `Researching ${researching}…` : counts.new ? `Research all ${counts.new}` : 'All researched'}
            </Button>
          )}
        </div>
        <div className="basis-full">
        <p className="mt-2 text-xs text-muted">
          {busy
            ? 'Claude is copying the names off the directory page. This is quick; you can leave this page.'
            : app.faculty_researched_on
              ? `Names taken from this page on ${formatDate(app.faculty_researched_on)}. Research people one at a time, or all at once, to see how well each matches you.`
              : 'Claude copies the names off this page without opening any profiles. Then research the people you care about, one at a time or all at once.'}
        </p>
        </div>
        {/* Extra pages: people who aren't on the supervisors list yet but could be */}
        <div className="basis-full border-t border-line pt-4">
          <div className="text-xs text-muted">Also add people from</div>
          {extraPages.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {extraPages.map((u) => (
                <li key={u}>
                  <a href={u} target="_blank" rel="noreferrer" className="block truncate text-sm text-live hover:underline">
                    {u.replace(/^https?:\/\/(www\.)?/, '')} ↗
                  </a>
                </li>
              ))}
            </ul>
          )}
          <form
            className="mt-2 flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              addFromPage()
            }}
          >
            <Input value={extraUrl} onChange={(e) => setExtraUrl(e.target.value)} placeholder="Department contacts or lab page link" className="h-8 max-w-96 flex-1 py-1 text-xs" />
            <Button size="sm" type="submit" disabled={!meta?.ai_configured || !extraUrl.trim().startsWith('http') || !!busy} title="Adds faculty on that page who aren't in the list yet, marked as not on the supervisors list">
              Add people
            </Button>
          </form>
        </div>
      </div>
      )}

      {people.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">{busy ? <Spinner className="text-live" /> : 'No faculty yet.'}</p>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <Segmented<MatchFilter>
              value={match}
              onChange={setMatch}
              options={[
                { id: 'all', label: `All ${people.length}` },
                { id: 'strong', label: `Strong ${counts.strong}` },
                { id: 'possible', label: `Possible ${counts.possible}` },
                { id: 'weak', label: `Other ${counts.weak}` },
                ...(counts.new ? [{ id: 'new' as MatchFilter, label: `Not researched ${counts.new}` }] : []),
              ]}
            />
            {isRanked && (
              <Segmented<'rank' | 'match'>
                value={order}
                onChange={setOrder}
                options={[
                  { id: 'rank', label: 'Ranked' },
                  { id: 'match', label: 'By match' },
                ]}
              />
            )}
            {groups.length > 1 && (
              <select value={group} onChange={(e) => setGroup(e.target.value)} className="h-8 rounded-lg border border-line bg-panel-2 px-2 text-xs text-text">
                <option value="">All groups</option>
                {groups.map((g) => (
                  <option key={g} value={g}>
                    {g} {people.filter((p) => p.group === g).length}
                  </option>
                ))}
              </select>
            )}
            {departments.length > 1 && (
              <select value={dept} onChange={(e) => setDept(e.target.value)} className="h-8 rounded-lg border border-line bg-panel-2 px-2 text-xs text-text">
                <option value="">All departments</option>
                {departments.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            )}
            {unlisted > 0 && (
              <select value={listing} onChange={(e) => setListing(e.target.value as typeof listing)} className="h-8 rounded-lg border border-line bg-panel-2 px-2 text-xs text-text">
                <option value="">Listed and not listed</option>
                <option value="listed">On the supervisors list {people.length - unlisted}</option>
                <option value="extra">Not on the list {unlisted}</option>
              </select>
            )}
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or research…" className="h-8 max-w-64 py-1 text-xs" />
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 4xl:grid-cols-4">
            {shown.map((f) => (
              <FacultyCard key={f.name} app={app} f={f} onOpen={() => setPerson(f.name)} />
            ))}
          </div>
          {shown.length === 0 && <p className="py-8 text-center text-sm text-muted">Nobody matches these filters.</p>}
        </>
      )}
    </div>
  )
}

export function FacultyCard({ app, f, onOpen }: { app: Application; f: FacultyProfile; onOpen?: () => void }) {
  const { update, runJob, jobs, meta } = useData()
  const busy = jobs.some((j) => isActive(j) && j.kind === 'faculty-member' && j.params?.app_id === app.id && j.params?.name === f.name)
  const research = () => runJob((strong) => api.researchFacultyMember(app.id, f.name, strong)).catch(() => undefined)
  const tracked = (app.faculty ?? []).some((c) => c.name.toLowerCase() === f.name.toLowerCase())
  const track = () =>
    update(app.id, { faculty: [...(app.faculty ?? []), { name: f.name, email: '', research: (f.research ?? '').split('.')[0], contacted_on: null, status: 'to contact', notes: '', rank: (app.faculty ?? []).length + 1 }] })
  const m = bucket(f)
  return (
    <article className={cx('flex flex-col rounded-lg border border-line bg-panel p-4', m === 'weak' && 'opacity-75')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-[1.1rem] leading-snug">
            {f.rank != null && (
              <span className="num mr-2 font-sans text-sm text-muted" title={f.tier ? `Rank ${f.rank}: ${f.tier}` : `Rank ${f.rank}`}>
                #{f.rank}
              </span>
            )}
            {onOpen ? (
              <button onClick={onOpen} className="text-left hover:text-live" title="Open their profile">
                {f.name}
              </button>
            ) : (
              f.name
            )}
          </h3>
          <p className="text-xs text-muted">{[f.title, f.department && !f.title.includes(f.department) ? f.department : ''].filter(Boolean).join(', ')}</p>
          {f.listed === false && <NotListed f={f} className="mt-1.5" />}
          {f.group && (
            <Tag tone="grey" className="mt-1.5">
              {f.group}
            </Tag>
          )}
        </div>
        <Tag family="match" value={m === 'new' ? null : m} className="shrink-0">{MATCH_LABEL[m]}</Tag>
      </div>
      {f.research && <p className="mt-3 text-sm leading-relaxed text-text/85">{f.research}</p>}
      {f.why && <p className="mt-2 border-l-2 border-line-strong pl-3 text-sm leading-relaxed text-text/80">{f.why}</p>}
      <div className="mt-auto flex items-center justify-between gap-3 pt-4">
        <div className="flex items-center gap-3">
          {f.url && (
            <a href={f.url} target="_blank" rel="noreferrer" className="text-xs text-live hover:underline">
              Profile ↗
            </a>
          )}
          {onOpen && (
            <button onClick={onOpen} className="text-xs text-live hover:underline">
              {f.deep_dive_on ? 'Deep dive' : 'Open'}
            </button>
          )}
          {f.accepting === 'yes' && <Tag family="accepting" value="yes">Taking students</Tag>}
          {f.accepting === 'no' && <Tag family="accepting" value="no">Not taking students</Tag>}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={researched(f) ? 'ghost' : 'primary'}
            onClick={research}
            loading={busy}
            disabled={!meta?.ai_configured || busy}
            title={f.researched_on ? `Researched ${formatDate(f.researched_on)}` : 'Reads their official profile and rates the fit with you'}
          >
            {busy ? 'Researching' : researched(f) ? 'Research again' : 'Research'}
          </Button>
          {tracked ? (
            <span className="text-xs text-live">On your supervisors list</span>
          ) : (
            <Button size="sm" onClick={track}>
              Add to supervisors
            </Button>
          )}
        </div>
      </div>
    </article>
  )
}

/** Added from an extra page: possible, but not on the program's supervisors list (yet). */
function NotListed({ f, className }: { f: FacultyProfile; className?: string }) {
  return (
    <Tag tone="grey" className={className} title={f.source ? `Added from ${f.source.replace(/^https?:\/\/(www\.)?/, '')}` : undefined}>
      Not on supervisor list
    </Tag>
  )
}

/**
 * One person in depth: the deep dive Claude wrote to <program>/Faculty/<Name>.md, plus your own notes in the same file.
 * Re-running the deep dive rewrites Claude's part and keeps your notes.
 */
function FacultyDeepDive({ app, f, onBack }: { app: Application; f: FacultyProfile; onBack: () => void }) {
  const { update, runJob, jobs, meta } = useData()
  const [file, setFile] = useState<FacultyFile | null>(null)
  const [notes, setNotes] = useState('')
  const [status, setStatus] = useState<'saved' | 'saving' | 'dirty'>('saved')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const job = jobs.find((j) => isActive(j) && j.kind === 'faculty-deep' && j.params?.app_id === app.id && j.params?.name === f.name)
  const tracked = (app.faculty ?? []).some((c) => c.name.toLowerCase() === f.name.toLowerCase())
  const m = bucket(f)

  // Reload whenever a deep dive lands (deep_dive_on changes).
  useEffect(() => {
    api.facultyProfile(app.id, f.name).then((r) => {
      setFile(r)
      setNotes(r.notes)
      setStatus('saved')
    })
  }, [app.id, f.name, f.deep_dive_on])

  const onNotes = (value: string) => {
    setNotes(value)
    setStatus('dirty')
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      setStatus('saving')
      await api.saveFacultyNotes(app.id, f.name, value)
      setStatus('saved')
    }, 800)
  }
  const deepDive = () => runJob((strong) => api.facultyDeepDive(app.id, f.name, strong)).catch(() => undefined)
  const track = () =>
    update(app.id, { faculty: [...(app.faculty ?? []), { name: f.name, email: '', research: (f.research ?? '').split('.')[0], contacted_on: null, status: 'to contact', notes: '', rank: (app.faculty ?? []).length + 1 }] })

  return (
    <div>
      <button onClick={onBack} className="mb-5 inline-flex items-center gap-1 text-sm text-muted hover:text-text">
        <span aria-hidden>‹</span> All faculty
      </button>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
        <div className="min-w-0">
          <h2 className="font-display text-[2rem] leading-tight">{f.name}</h2>
          <p className="text-sm text-muted">{[f.title, f.department && !f.title?.includes(f.department) ? f.department : ''].filter(Boolean).join(', ')}</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Tag family="match" value={m === 'new' ? null : m}>
              {MATCH_LABEL[m]}
            </Tag>
            {f.rank != null && (
              <Tag tone="grey">
                Rank {f.rank} of {(app.faculty_profiles ?? []).filter((p) => p.rank != null).length}
                {f.tier ? `, ${f.tier.toLowerCase()}` : ''}
              </Tag>
            )}
            {f.group && <Tag tone="grey">{f.group}</Tag>}
            {f.listed === false && <NotListed f={f} />}
            {f.accepting === 'yes' && <Tag family="accepting" value="yes">Taking students</Tag>}
            {f.accepting === 'no' && <Tag family="accepting" value="no">Not taking students</Tag>}
            {f.url && (
              <ExternalLink href={f.url} className="text-sm">
                Official profile
              </ExternalLink>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <OpusToggle className="h-8" />
          <Button
            variant={f.deep_dive_on ? 'subtle' : 'primary'}
            onClick={deepDive}
            loading={!!job}
            disabled={!meta?.ai_configured || !!job}
            title="Reads their profile, lab page, publications and teaching, and writes it all to this program's Faculty folder. Your notes are kept."
          >
            {job ? 'Researching' : f.deep_dive_on ? 'Deep dive again' : 'Deep dive'}
          </Button>
          {tracked ? <span className="text-xs text-live">On your supervisors list</span> : <Button onClick={track}>Add to supervisors</Button>}
        </div>
      </div>

      <div className="grid items-start gap-x-12 gap-y-8 xl:grid-cols-[minmax(0,1fr)_360px] 3xl:grid-cols-[minmax(0,1fr)_440px]">
        <section className="min-w-0">
          {job && <p className="mb-4 text-sm text-live">{job.activity?.[job.activity.length - 1]?.text ?? 'Waiting for a free agent'}</p>}
          {!file ? (
            <Spinner className="text-live" />
          ) : file.exists && file.text ? (
            <div className="max-w-[80ch]">
              <Markdown>{file.text.replace(/^# .*\n+/, '')}</Markdown>
            </div>
          ) : (
            <div className="max-w-[60ch] text-sm text-muted">
              {f.research && <p className="mb-3 text-text/85">{f.research}</p>}
              {f.why && <p className="mb-3 border-l-2 border-line-strong pl-3 text-text/80">{f.why}</p>}
              <p>
                No deep dive yet. It covers their background, research themes, recent papers, lab and students, teaching, what they say about taking
                master's students, how your work fits theirs, and how to approach them.
              </p>
            </div>
          )}
        </section>

        <aside className="space-y-6 xl:sticky xl:top-6">
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="font-display text-xl">My notes</h3>
              <span className="text-xs text-muted">{status === 'saved' ? 'Saved' : status === 'saving' ? 'Saving…' : 'Editing'}</span>
            </div>
            <Textarea value={notes} onChange={(e) => onNotes(e.target.value)} rows={12} placeholder="Papers you read, what you'd ask, replies, impressions. Kept when the deep dive is re-run." />
          </div>
          {file?.exists && (
            <div className="space-y-2 text-xs text-muted">
              {file.meta.researched_on && <div>Deep dive from {formatDate(file.meta.researched_on)}</div>}
              {file.file && <div className="break-all">Saved in {file.file}</div>}
              {(file.meta.sources ?? []).length > 0 && (
                <ul className="space-y-1">
                  {(file.meta.sources ?? []).map((u) => (
                    <li key={u}>
                      <ExternalLink href={u} className="max-w-full">
                        {u.replace(/^https?:\/\/(www\.)?/, '')}
                      </ExternalLink>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
