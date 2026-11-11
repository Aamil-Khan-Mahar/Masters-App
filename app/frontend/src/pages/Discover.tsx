import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, isActive, type Application, type Candidate, type SavedSearch } from '../api'
import { useData } from '../data'
import { appPath, cx, formatDate, shortName } from '../lib'
import NewApplication from '../components/NewApplication'
import OpusToggle from '../components/OpusToggle'
import { Button, ExternalLink, OpenLink, PageHeader, Section, Spinner, Tag, Textarea, ViewSwitch } from '../components/ui'

const EXAMPLES = [
  'Funded 1–2 year MSc programs in data science or ML in Canada for Fall 2027',
  'Thesis-based CS masters in Germany with low tuition and strong ML research groups',
  'Fully funded scholarships for international students to do a master’s in AI abroad',
]

type Kind = 'program' | 'scholarship'

/** A result is a scholarship if Claude filled in a provider but no university, whatever the search was for. */
const candidateKind = (c: Candidate, fallback: Kind): Kind => (c.provider && !c.university ? 'scholarship' : c.university ? 'program' : fallback)

const norm = (s?: string) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

function elapsed(since: string, now: number) {
  const secs = Math.max(0, Math.round((now - new Date(since).getTime()) / 1000))
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
}

export default function Discover() {
  const { apps, jobs, runJob, runMission, runningJob, busyApp, replaceApp, toast, meta } = useData()
  const [query, setQuery] = useState('')
  const [params] = useSearchParams()
  const [kind, setKind] = useState<Kind>(params.get('kind') === 'scholarship' ? 'scholarship' : 'program')
  // How many results to ask for; remembered in this browser only.
  const [count, setCount] = useState<number>(() => {
    try {
      return Math.min(50, Math.max(3, Number(localStorage.getItem('discover-count')) || 8))
    } catch {
      return 8
    }
  })
  const pickCount = (n: number) => {
    setCount(n)
    try {
      localStorage.setItem('discover-count', String(n))
    } catch {
      /* private window: just don't remember it */
    }
  }
  const [history, setHistory] = useState<SavedSearch[]>([])
  const [selected, setSelected] = useState(0)
  const [adding, setAdding] = useState(false)
  const [now, setNow] = useState(Date.now())

  // Search state lives on the server and in the app-wide job list, so it survives page changes.
  const running = runningJob('discover')
  const latest: SavedSearch | undefined = history[selected] ?? history[0]

  // Reload saved searches on open and whenever a search finishes; jump to the newest one.
  const finishedSearches = jobs.filter((j) => j.kind === 'discover' && j.status === 'done').length
  useEffect(() => {
    api
      .discoverHistory()
      .then((h) => {
        setHistory(h)
        setSelected(0)
      })
      .catch(() => undefined)
  }, [finishedSearches])

  const forget = async (i: number) => {
    setHistory(await api.forgetSearch(i))
    setSelected(0)
  }

  const anyRunning = jobs.some(isActive)
  useEffect(() => {
    if (!anyRunning) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [anyRunning])

  const search = (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim() || running) return
    runJob((strong) => api.discover(query.trim(), kind, strong, count)).catch(() => undefined)
  }

  const research = (app: Application) => {
    runMission(app.id, { force: !!app.researched_on }).catch(() => undefined)
  }

  /** The tracked application matching a search result, if it was already added. */
  const existing = (c: Candidate) =>
    apps.find((a) => (c.university ? norm(a.university) === norm(c.university) && norm(a.name) === norm(c.name) : norm(a.name) === norm(c.name)))

  const add = async (c: Candidate, thenResearch: boolean) => {
    const k = candidateKind(c, latest?.kind ?? kind)
    try {
      const created = await api.create(
        k === 'program'
          ? { kind: k, name: c.name, university: c.university, country: c.country, city: c.city, degree: c.degree, url: c.url }
          : { kind: k, name: c.name, provider: c.provider, country: c.country, url: c.url },
      )
      replaceApp(created)
      toast(`Added ${c.name}`)
      if (thenResearch) research(created)
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  const tracked = [...apps].filter((a) => !a.archived).sort((a, b) => (a.researched_on ?? '').localeCompare(b.researched_on ?? ''))
  const notResearched = tracked.filter((a) => !a.researched_on).length

  return (
    <>
      <PageHeader
        title="Discover"
        subtitle="Describe what you want and Claude finds programs or scholarships that fit. Add the good ones, then research each in depth. Searches keep running if you leave this page."
        actions={<Button onClick={() => setAdding(true)}>Add one yourself</Button>}
      />

      <form onSubmit={search} className="mb-10 max-w-[1400px] rounded-lg border border-line-strong bg-panel p-4 md:p-5">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <ViewSwitch<Kind>
            value={kind}
            onChange={setKind}
            views={[
              { id: 'program', label: 'Programs' },
              { id: 'scholarship', label: 'Scholarships' },
            ]}
          />
          <OpusToggle className="h-9" />
          <label className="ml-auto flex items-center gap-3 text-sm text-muted">
            <span className="whitespace-nowrap">
              Find <span className="num inline-block w-6 text-right font-medium text-text">{count}</span> {kind === 'program' ? 'programs' : 'scholarships'}
              {count > 20 && <span className="ml-2 text-accent">takes several minutes</span>}
            </span>
            <input type="range" min={3} max={50} step={1} value={count} onChange={(e) => pickCount(Number(e.target.value))} className="w-36 accent-[var(--color-live)] sm:w-48" aria-label="How many results to find" />
          </label>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={kind === 'program' ? 'For example: funded ML master’s in Canada with a thesis option' : 'For example: full scholarships for international students in Europe'}
            rows={2}
            className="flex-1 resize-none text-base"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                search(e)
              }
            }}
          />
          <Button variant="primary" type="submit" loading={!!running} disabled={!meta?.ai_configured || !!running || !query.trim()} className="h-auto min-h-11 sm:w-36">
            {running ? 'Searching' : 'Search'}
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" onClick={() => setQuery(ex)} className="rounded-full px-3 py-1 text-left text-sm text-muted ring-1 ring-line hover:text-text hover:ring-line-strong">
              {ex}
            </button>
          ))}
        </div>
        {!meta?.ai_configured && <p className="mt-3 text-sm text-danger">AI is off: log in to Claude Code or add an API key, then restart the app.</p>}
      </form>

      {running && (
        <div className="mb-8 flex max-w-[1400px] items-center gap-4 rounded-lg border border-live/40 bg-live/5 px-5 py-4 text-sm">
          <Spinner className="text-live" />
          <div className="min-w-0 flex-1">
            <div className="truncate">
              Searching for <span className="text-text">“{running.params?.query ?? running.label}”</span>
              {running.status === 'waiting' && <span className="text-muted">. {running.agent} is waiting for a free slot.</span>}
            </div>
            <div className="text-muted">Claude is searching the web and checking official pages. Usually 1 to 3 minutes; use other pages meanwhile.</div>
          </div>
          <span className="num text-muted">{elapsed(running.started ?? running.created, now)}</span>
        </div>
      )}

      <div className="grid items-start gap-x-14 gap-y-12 xl:grid-cols-[minmax(0,1fr)_380px] 3xl:grid-cols-[minmax(0,1fr)_440px]">
        <div className="min-w-0">
          {latest && latest.results.length > 0 ? (
            <Section title={`${latest.results.length} found`} aside={<span className="hidden max-w-[40ch] truncate text-muted sm:inline">for “{latest.query}”, {formatDate(latest.at.slice(0, 10))}</span>}>
              <div className="grid gap-4 pt-2 md:grid-cols-2 4xl:grid-cols-3">
                {latest.results.map((c, i) => {
                  const k = candidateKind(c, latest.kind)
                  const already = existing(c)
                  const busy = already && busyApp(already.id)
                  return (
                    <div key={i} className="flex flex-col rounded-lg border border-line bg-panel p-5">
                      <div className="font-display text-[1.25rem] leading-tight">{k === 'program' ? c.university : c.name}</div>
                      <div className="mt-1 text-sm text-text/80">{k === 'program' ? c.name : c.provider}</div>
                      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-sm">
                        <Tag family="kind" value={k} />
                        {c.country && <span className="text-muted">{[c.city, c.country].filter(Boolean).join(', ')}</span>}
                      </div>
                      <p className="mt-3 line-clamp-4 flex-1 text-sm leading-relaxed text-muted">{c.why}</p>
                      {c.deadline_hint && <p className="mt-2 truncate text-sm" title={c.deadline_hint}>Deadline: {c.deadline_hint}</p>}
                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
                        {c.url ? <ExternalLink href={c.url} className="text-sm">Official page</ExternalLink> : <span />}
                        {already ? (
                          <OpenLink to={appPath(already)}>
                            {busy ? (
                              <span className="flex items-center gap-2">
                                <Spinner className="text-live" /> Researching
                              </span>
                            ) : (
                              'Added, open it'
                            )}
                          </OpenLink>
                        ) : (
                          <div className="flex gap-2">
                            <Button size="sm" variant="ghost" onClick={() => add(c, false)}>
                              Add
                            </Button>
                            <Button size="sm" onClick={() => add(c, true)} disabled={!meta?.ai_configured}>
                              Add and research
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </Section>
          ) : (
            !running && (
              <Section title="Results">
                <p className="py-3 text-sm text-muted">Search above. Results stay here, and every search is kept on the right so you can go back to it.</p>
              </Section>
            )
          )}
        </div>

        <aside className="space-y-10">
          {history.length > 0 && (
            <Section title="Recent searches" count={history.length}>
              <ul className="divide-y divide-line">
                {history.map((h, i) => (
                  <li key={`${h.query}-${h.at}`} className="group flex items-start gap-3 py-2.5">
                    <button onClick={() => setSelected(i)} className={cx('min-w-0 flex-1 text-left text-sm', i === selected ? 'text-live' : 'hover:text-live')}>
                      <span className="line-clamp-2">{h.query}</span>
                      <span className="text-xs text-muted">
                        {h.results.length} found, {formatDate(h.at.slice(0, 10))}
                      </span>
                    </button>
                    <button onClick={() => forget(i)} className="text-muted opacity-60 group-hover:opacity-100 hover:text-danger" aria-label={`Forget search ${h.query}`} title="Forget this search">
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Your list" count={tracked.length} open={{ to: '/applications', label: 'Applications' }}>
            {tracked.length === 0 ? (
              <p className="py-3 text-sm text-muted">Nothing tracked yet. Search above or add one yourself.</p>
            ) : (
              <>
                {notResearched > 0 && <p className="pb-2 text-sm text-accent">{notResearched} not researched yet.</p>}
                <ul className="divide-y divide-line">
                  {tracked.map((a) => {
                    const busy = busyApp(a.id)
                    return (
                      <li key={a.id} className="flex items-center gap-3 py-2.5">
                        <Link to={appPath(a)} className="min-w-0 flex-1 hover:text-live">
                          <div className="truncate text-sm">{shortName(a)}</div>
                          <div className={cx('text-xs', busy ? 'text-live' : a.researched_on ? 'text-muted' : 'text-accent')}>
                            {busy ? `Researching, ${elapsed(busy.started ?? busy.created, now)}` : a.researched_on ? `Researched ${formatDate(a.researched_on)}` : 'Not researched'}
                          </div>
                        </Link>
                        <Button size="sm" variant="ghost" loading={!!busy} disabled={!meta?.ai_configured || !!busy} onClick={() => research(a)}>
                          {a.researched_on ? 'Refresh' : 'Research'}
                        </Button>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </Section>
        </aside>
      </div>
      <NewApplication open={adding} onClose={() => setAdding(false)} kind={kind} />
    </>
  )
}
