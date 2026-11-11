import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, isActive, type Application, type FacultyContact, type FacultyProfile } from '../api'
import { useData } from '../data'
import { CONTACT_STATUS, firstSentence } from '../applyTasks'
import { cx, formatDate, todayISO } from '../lib'
import { Button, EditableText, ExternalLink, Input, Spinner, Tag } from './ui'

const STATUSES = ['to contact', 'emailed', 'no reply', 'replied', 'meeting', 'not taking students']
const MATCH_ORDER: Record<string, number> = { strong: 0, possible: 1, weak: 3 }
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** Your supervisors in your order of preference: ranked by `rank`, then the order they were added. */
export function ranked(app: Application): FacultyContact[] {
  const list = app.faculty ?? []
  return [...list].sort((a, b) => (a.rank ?? 1e6 + list.indexOf(a)) - (b.rank ?? 1e6 + list.indexOf(b)))
}

/**
 * Finalising supervisors for one program: the people you might work with, in your order, where each conversation
 * stands, and which names go on the application. Add people from the program's faculty list or anyone else by hand.
 */
export default function Supervisors({ app }: { app: Application }) {
  const { update, runJob, jobs, meta, toast } = useData()
  const [, setParams] = useSearchParams()
  const people = ranked(app)
  const profiles = app.faculty_profiles ?? []
  const profileOf = (name: string) => profiles.find((p) => same(p.name, name))
  const finals = people.filter((c) => c.final)
  const busy = (name: string) => jobs.find((j) => isActive(j) && (j.kind === 'faculty-member' || j.kind === 'faculty-deep') && j.params?.app_id === app.id && same(j.params?.name ?? '', name))

  // Every change rewrites the list in display order with ranks 1..n, so the order you see is the order saved.
  const save = (list: FacultyContact[]) => update(app.id, { faculty: list.map((c, i) => ({ ...c, rank: i + 1 })) })
  const patch = (name: string, p: Partial<FacultyContact>) => save(people.map((c) => (same(c.name, name) ? { ...c, ...p } : c)))
  const move = (i: number, d: number) => {
    const j = i + d
    if (j < 0 || j >= people.length) return
    const next = [...people]
    ;[next[i], next[j]] = [next[j], next[i]]
    save(next)
  }
  const remove = (name: string) => {
    if (!confirm(`Take ${name} off your supervisors for this program? Their faculty card stays.`)) return
    save(people.filter((c) => !same(c.name, name)))
  }
  const research = (name: string) => runJob((strong) => api.researchFacultyMember(app.id, name, strong)).catch(() => undefined)
  const openProfile = (name: string) => setParams({ app: app.id, page: 'program', tab: 'faculty', person: name })
  const copyFinal = async () => {
    const text = finals.map((c, i) => `${i + 1}. ${c.name}${profileOf(c.name)?.title ? `, ${profileOf(c.name)!.title}` : ''}${c.email ? ` (${c.email})` : ''}`).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      toast(`Copied ${finals.length} name${finals.length === 1 ? '' : 's'}`)
    } catch {
      toast('Could not copy to the clipboard', 'error')
    }
  }

  const add = (p: { name: string; email?: string; research?: string }) =>
    save([...people, { name: p.name, email: p.email ?? '', research: firstSentence(p.research ?? ''), contacted_on: null, status: 'to contact', notes: '' }])

  return (
    <div className="grid items-start gap-x-12 gap-y-10 xl:grid-cols-[minmax(0,1fr)_24rem] 3xl:grid-cols-[minmax(0,1fr)_28rem]">
      <section className="min-w-0">
        <div className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-2 border-b border-line pb-3">
          <h2 className="font-display text-xl">Your supervisors</h2>
          <span className="text-sm text-muted">
            {people.length ? `${people.length} in your order of preference, ${finals.length} on your application` : 'Nobody yet'}
          </span>
          {finals.length > 0 && (
            <Button size="sm" className="ml-auto" onClick={copyFinal} title="Names, titles and emails of the ones on your application, in order">
              Copy names for the portal
            </Button>
          )}
        </div>
        {people.length === 0 && <p className="text-sm text-muted">Add people from the program's faculty on the right, or anyone else by name.</p>}
        <ol className="space-y-3">
          {people.map((c, i) => {
            const p = profileOf(c.name)
            const job = busy(c.name)
            return (
              <li key={c.name} className={cx('rounded-lg border bg-panel p-4', c.final ? 'border-live/50' : 'border-line')}>
                <div className="flex items-start gap-3">
                  <div className="flex shrink-0 flex-col items-center gap-0.5 pt-0.5">
                    <button onClick={() => move(i, -1)} disabled={i === 0} className="px-1 text-xs leading-none text-muted hover:text-text disabled:opacity-20" aria-label={`Move ${c.name} up`}>
                      ▲
                    </button>
                    <span className="num font-display text-lg leading-none">{i + 1}</span>
                    <button onClick={() => move(i, 1)} disabled={i === people.length - 1} className="px-1 text-xs leading-none text-muted hover:text-text disabled:opacity-20" aria-label={`Move ${c.name} down`}>
                      ▼
                    </button>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="font-display text-[1.2rem] leading-tight">{c.name}</span>
                      {p?.match && <Tag family="match" value={p.match} />}
                      {p?.accepting === 'yes' && <Tag family="accepting" value="yes">Taking students</Tag>}
                      {p?.accepting === 'no' && <Tag family="accepting" value="no">Not taking students</Tag>}
                    </div>
                    {p?.title && <div className="text-xs text-muted">{p.title}</div>}
                    {(p?.research || c.research) && <p className="mt-1.5 line-clamp-2 text-sm text-text/85">{p?.research || c.research}</p>}
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className="text-xs text-muted">
                        Where it stands
                        <select
                          value={STATUSES.includes(c.status) ? c.status : 'emailed'}
                          onChange={(e) => patch(c.name, { status: e.target.value, contacted_on: e.target.value === 'to contact' ? null : c.contacted_on ?? todayISO() })}
                          className="mt-1 h-8 w-full rounded-md border border-line-strong bg-bg px-2 text-sm text-text"
                        >
                          {STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {CONTACT_STATUS[s]}
                            </option>
                          ))}
                        </select>
                        {c.contacted_on && <span className="mt-1 block">Emailed {formatDate(c.contacted_on)}</span>}
                      </label>
                      <label className="text-xs text-muted">
                        Email
                        <EditableText value={c.email} onSave={(v) => patch(c.name, { email: v.trim() })} placeholder="their@university.ca" className="mt-1 h-8 py-1" />
                      </label>
                    </div>
                    <div className="mt-3">
                      <EditableText value={c.notes} onSave={(v) => patch(c.name, { notes: v })} placeholder="Your notes: what you wrote, what they said, why them" multiline className="text-sm" />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                      <label className="flex cursor-pointer items-center gap-2">
                        <input type="checkbox" checked={!!c.final} onChange={() => patch(c.name, { final: !c.final })} className="h-4 w-4 accent-[var(--color-live)]" />
                        On my application
                      </label>
                      {p?.url && <ExternalLink href={p.url}>Official profile</ExternalLink>}
                      {p && (
                        <button onClick={() => openProfile(p.name)} className="text-live hover:underline">
                          {p.deep_dive_on ? 'Deep dive' : 'Full profile'}
                        </button>
                      )}
                      {p &&
                        (job ? (
                          <span className="flex items-center gap-1.5 text-xs text-live">
                            <Spinner /> {job.activity?.[job.activity.length - 1]?.text ?? 'Researching'}
                          </span>
                        ) : (
                          <button onClick={() => research(p.name)} disabled={!meta?.ai_configured} className="text-muted hover:text-live disabled:opacity-40" title={p.researched_on ? `Researched ${formatDate(p.researched_on)}` : 'Reads their profile and rates the fit with you'}>
                            {p.researched_on ? 'Research again' : 'Research with Claude'}
                          </button>
                        ))}
                      <button onClick={() => remove(c.name)} className="ml-auto text-xs text-muted hover:text-danger">
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      </section>

      <aside className="space-y-10 xl:sticky xl:top-6">
        <FromFaculty profiles={profiles} tracked={people} onAdd={(p) => add({ name: p.name, research: p.research })} />
        <AddSomeone app={app} profiles={profiles} people={people} onAdded={(name, doResearch) => doResearch && research(name)} canResearch={!!meta?.ai_configured} />
      </aside>
    </div>
  )
}

/** The program's faculty you haven't added yet, in your ranking if they are ranked, else best matches first. */
function FromFaculty({ profiles, tracked, onAdd }: { profiles: FacultyProfile[]; tracked: FacultyContact[]; onAdd: (p: FacultyProfile) => void }) {
  const [q, setQ] = useState('')
  const [all, setAll] = useState(false)
  const free = profiles
    .filter((p) => !tracked.some((c) => same(c.name, p.name)))
    .filter((p) => !q || `${p.name} ${p.research ?? ''} ${p.department ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (a.rank ?? 1e6) - (b.rank ?? 1e6) || (MATCH_ORDER[a.match ?? ''] ?? 2) - (MATCH_ORDER[b.match ?? ''] ?? 2))
  const shown = all || q ? free : free.slice(0, 8)
  return (
    <section>
      <h3 className="mb-2 border-b border-line pb-2 font-display text-lg">From this program's faculty</h3>
      {profiles.length === 0 ? (
        <p className="text-sm text-muted">No faculty list for this program yet. Add people by hand below.</p>
      ) : (
        <>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search names or research" className="mb-2 h-8 text-sm" />
          <ul className="divide-y divide-line">
            {shown.map((p) => (
              <li key={p.name} className="flex items-start gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 text-sm">
                    {p.rank != null && <span className="num text-xs text-muted">#{p.rank}</span>}
                    <span className="truncate">{p.name}</span>
                    {p.match && <Tag family="match" value={p.match} />}
                  </div>
                  {p.research && <div className="line-clamp-1 text-xs text-muted">{p.research}</div>}
                </div>
                <Button size="sm" onClick={() => onAdd(p)}>
                  Add
                </Button>
              </li>
            ))}
          </ul>
          {!q && free.length > shown.length && (
            <button onClick={() => setAll(true)} className="mt-2 text-xs text-live hover:underline">
              Show all {free.length}
            </button>
          )}
          {free.length === 0 && <p className="py-2 text-sm text-muted">{q ? 'Nobody matches.' : 'Everyone on the list is already added.'}</p>}
        </>
      )}
    </section>
  )
}

/** Someone who isn't on the program's list: a co-supervisor, someone from another department, a name you heard. */
function AddSomeone({ app, profiles, people, onAdded, canResearch }: { app: Application; profiles: FacultyProfile[]; people: FacultyContact[]; onAdded: (name: string, research: boolean) => void; canResearch: boolean }) {
  const { update, toast } = useData()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [url, setUrl] = useState('')
  const [area, setArea] = useState('')
  const [lookUp, setLookUp] = useState(true)
  const submit = async () => {
    const n = name.trim()
    if (!n) return
    if (people.some((c) => same(c.name, n))) return toast(`${n} is already on your list`, 'error')
    // A faculty card too, so they can be researched and opened like everyone else (marked as added by you).
    const known = profiles.some((p) => same(p.name, n))
    const nextProfiles = known ? profiles : [...profiles, { name: n, title: '', research: area.trim(), url: url.trim(), listed: false, source: 'Added by you' }]
    const contact: FacultyContact = { name: n, email: email.trim(), research: firstSentence(area.trim()), contacted_on: null, status: 'to contact', notes: '', rank: people.length + 1 }
    await update(app.id, { faculty_profiles: nextProfiles, faculty: [...people.map((c, i) => ({ ...c, rank: i + 1 })), contact] })
    onAdded(n, lookUp && canResearch)
    setName('')
    setEmail('')
    setUrl('')
    setArea('')
  }
  return (
    <section>
      <h3 className="mb-2 border-b border-line pb-2 font-display text-lg">Add someone else</h3>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className="h-8 text-sm" />
        <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email (optional)" className="h-8 text-sm" />
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Profile or lab page link (optional)" className="h-8 text-sm" />
        <Input value={area} onChange={(e) => setArea(e.target.value)} placeholder="What they work on (optional)" className="h-8 text-sm" />
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button size="sm" variant="primary" type="submit" disabled={!name.trim()}>
            Add
          </Button>
          {canResearch && (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
              <input type="checkbox" checked={lookUp} onChange={(e) => setLookUp(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--color-live)]" />
              Research them with Claude
            </label>
          )}
        </div>
      </form>
    </section>
  )
}
