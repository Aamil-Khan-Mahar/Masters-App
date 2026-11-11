import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api, isActive, type Application, type Building, type Job, type Role } from '../api'
import { useData } from '../data'
import { applyPath } from '../applyTasks'
import { appPath, cx, formatDate } from '../lib'
import OpusToggle from '../components/OpusToggle'
import { Badge, Button, Card, Label, PageHeader, Section, Select, Tag, Textarea } from '../components/ui'

// ------------------------------------------------------------------ town plan

type Place = Building | 'hall'
interface Spot { x: number; y: number; name: string; role?: Role; does: string; side: 1 | -1 }

/** Door positions in the 1000×640 map; agents stand there and their bubble opens to `side`. */
const PLACES: Record<Place, Spot> = {
  observatory: { x: 175, y: 205, name: 'Observatory', role: 'scout', does: 'Scouts search the web for programs and scholarships', side: 1 },
  library: { x: 500, y: 150, name: 'Library', role: 'researcher', does: 'Researchers write a program’s profile: overview, requirements, deadlines, fees', side: 1 },
  faculty_hall: { x: 825, y: 205, name: 'Faculty hall', role: 'recruiter', does: 'Recruiters read the supervisor directory and match faculty to you', side: -1 },
  bank: { x: 175, y: 535, name: 'Bank', role: 'accountant', does: 'Accountants work out funding packages, awards and what you would pay', side: 1 },
  admissions: { x: 500, y: 590, name: 'Admissions office', role: 'assessor', does: 'Assessors score fit, cost, admit chance and career, and set the tier', side: 1 },
  studio: { x: 825, y: 535, name: 'Writing studio', role: 'coach', does: 'Coaches give SOP structure and critique, never prose to paste', side: -1 },
  hall: { x: 500, y: 334, name: 'Town hall', does: 'Every agent is dispatched from here and waits in the square for a free slot', side: 1 },
}
const SQUARE = { x: 500, y: 372 }

const ROLE: Record<Role, { label: string; color: string }> = {
  scout: { label: 'Scout', color: '#2e9bff' },
  researcher: { label: 'Researcher', color: '#ffd400' },
  recruiter: { label: 'Recruiter', color: '#74c69d' },
  accountant: { label: 'Accountant', color: '#ffe066' },
  assessor: { label: 'Assessor', color: '#ff6259' },
  coach: { label: 'Coach', color: '#b79cf0' },
}

const STATUS: Record<Job['status'], { label: string; cls: string }> = {
  waiting: { label: 'Waiting', cls: 'bg-panel-2 text-muted ring-line' },
  working: { label: 'Working', cls: 'bg-live/10 text-live ring-live/40' },
  done: { label: 'Done', cls: 'bg-ok/10 text-ok ring-ok/25' },
  error: { label: 'Failed', cls: 'bg-danger/10 text-danger ring-danger/25' },
  cancelled: { label: 'Stood down', cls: 'bg-panel-2 text-muted ring-line' },
}

const RETURN_MS = 7000 // finished agents walk back to the hall and linger this long

const ts = (iso?: string | null) => (iso ? new Date(iso).getTime() : 0)
function ago(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h ${m % 60}m`
}
const lastLine = (j: Job) => j.activity?.[j.activity.length - 1]?.text ?? ''

type Panel = { type: 'agent'; id: string } | { type: 'place'; place: Place } | null

// ------------------------------------------------------------------ page

export default function Town() {
  const { jobs, meta } = useData()
  const [panel, setPanel] = useState<Panel>(null)
  const [now, setNow] = useState(Date.now())
  const [maxActive, setMaxActive] = useState(3)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    api.agentsMeta().then((m) => setMaxActive(m.max_active)).catch(() => undefined)
    return () => clearInterval(t)
  }, [])

  const active = jobs.filter(isActive)
  const working = active.filter((j) => j.status === 'working')
  const waiting = active.filter((j) => j.status === 'waiting').sort((a, b) => a.created.localeCompare(b.created))
  const returning = jobs.filter((j) => !isActive(j) && !j.from_history && now - ts(j.finished) < RETURN_MS)
  const history = jobs.filter((j) => !isActive(j)).sort((a, b) => (b.finished ?? '').localeCompare(a.finished ?? ''))
  const selected = panel?.type === 'agent' ? jobs.find((j) => j.id === panel.id) : undefined

  return (
    <>
      <PageHeader
        title="Agent Town"
        subtitle={
          <>
            Every AI task is an agent. Up to {maxActive} work at once; the rest wait in the square and make no Claude calls until a slot frees up. Click a building to send
            someone, or an agent to follow their work.
          </>
        }
        actions={<OpusToggle />}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <span>
              <span className="num text-live">{working.length}</span>
              <span className="text-muted"> of {maxActive} working</span>
            </span>
            <span>
              <span className="num">{waiting.length}</span>
              <span className="text-muted"> waiting in the square</span>
            </span>
            <span className="text-muted">
              <span className="num text-text">{history.length}</span> finished
            </span>
            {!meta?.ai_configured && <span className="text-danger">AI is off: log in to Claude Code or add an API key, then restart.</span>}
          </div>
          <Village working={working} waiting={waiting} returning={returning} selectedId={selected?.id} panel={panel} onSelect={setPanel} />
          <Legend />
          <UsageLog />
        </div>

        <aside className="xl:sticky xl:top-6 xl:self-start">
          {selected ? (
            <AgentPanel job={selected} jobs={jobs} now={now} onClose={() => setPanel(null)} onSelect={(id) => setPanel({ type: 'agent', id })} />
          ) : panel?.type === 'place' ? (
            <PlacePanel place={panel.place} jobs={active} onClose={() => setPanel(null)} onSelect={(id) => setPanel({ type: 'agent', id })} />
          ) : (
            <HistoryPanel history={history} now={now} onSelect={(id) => setPanel({ type: 'agent', id })} />
          )}
        </aside>
      </div>
    </>
  )
}

// ------------------------------------------------------------------ AI usage (moved here from Profile)

function UsageLog() {
  const { apps } = useData()
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof api.usage>>>([])
  const [all, setAll] = useState(false)
  useEffect(() => {
    api.usage().then(setUsage).catch(() => undefined)
  }, [])
  const spend = usage.reduce((t, u) => t + u.cost_usd, 0)
  const byLabel = (label: string) => apps.find((a) => a.name === label)
  const shown = all ? usage : usage.slice(0, 12)
  return (
    <Section title="AI usage" count={usage.length} aside={<span className="num text-muted">API spend ${spend.toFixed(2)}</span>} className="mt-8">
      <p className="pb-2 text-sm text-muted">Calls through your Claude subscription cost nothing extra; they count toward your plan's usage limits.</p>
      {usage.length === 0 ? (
        <p className="py-2 text-sm text-muted">No AI calls yet.</p>
      ) : (
        <>
          <ul className="divide-y divide-line">
            {shown.map((u, i) => {
              const app = byLabel(u.label)
              return (
                <li key={i} className="flex items-center gap-4 py-2 text-sm">
                  <Tag tone="grey" className="w-24 justify-center">
                    {u.kind}
                  </Tag>
                  {app ? (
                    <Link to={appPath(app)} className="min-w-0 flex-1 truncate hover:text-live">
                      {u.label}
                    </Link>
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-muted">{u.label}</span>
                  )}
                  <span className="num shrink-0 text-xs text-muted">{u.at ? formatDate(u.at.slice(0, 10)) : ''}</span>
                  <span className="num w-24 shrink-0 text-right text-xs">{u.backend === 'claude-code' ? 'subscription' : `$${u.cost_usd.toFixed(3)}`}</span>
                </li>
              )
            })}
          </ul>
          {usage.length > 12 && (
            <button onClick={() => setAll((a) => !a)} className="mt-2 text-sm text-live hover:underline">
              {all ? 'Show fewer' : `Show all ${usage.length}`}
            </button>
          )}
        </>
      )}
    </Section>
  )
}

// ------------------------------------------------------------------ the map

function Village({ working, waiting, returning, selectedId, panel, onSelect }: { working: Job[]; waiting: Job[]; returning: Job[]; selectedId?: string; panel: Panel; onSelect: (p: Panel) => void }) {
  // Agents seen for the first time start at the hall door, then walk to where they belong.
  const [arrived, setArrived] = useState<Set<string>>(new Set())
  const all = [...working, ...waiting, ...returning]
  const ids = all.map((j) => j.id).join(',')
  useEffect(() => {
    const fresh = all.filter((j) => !arrived.has(j.id))
    if (!fresh.length) return
    const t = setTimeout(() => setArrived((s) => new Set([...s, ...fresh.map((j) => j.id)])), 60)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids])

  const busyAt = (b: Place) => working.filter((j) => j.building === b).length

  const position = (j: Job): { x: number; y: number } => {
    const hall = PLACES.hall
    if (!arrived.has(j.id) || !isActive(j)) return { x: hall.x + 26, y: hall.y + 4 }
    if (j.status === 'waiting') {
      const i = waiting.findIndex((w) => w.id === j.id)
      const row = Math.floor(i / 7)
      const col = i % 7
      return { x: SQUARE.x - 96 + col * 32 + (row % 2) * 16, y: SQUARE.y + 18 + row * 26 }
    }
    const spot = PLACES[j.building] ?? PLACES.library
    const here = working.filter((w) => w.building === j.building)
    const i = here.findIndex((w) => w.id === j.id)
    return { x: spot.x + (i - (here.length - 1) / 2) * 32, y: spot.y + 22 }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-bg">
      <svg viewBox="0 0 1000 640" className="block h-auto w-full select-none" role="img" aria-label="Agent Town map">
        <defs>
          <pattern id="town-dots" width="22" height="22" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1" fill="#1a1a1a" />
          </pattern>
          <radialGradient id="town-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffd400" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#ffd400" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="1000" height="640" fill="url(#town-dots)" />

        {/* roads from the square to every door */}
        {(Object.keys(PLACES) as Place[])
          .filter((p) => p !== 'hall')
          .map((p) => (
            <g key={p}>
              <line x1={SQUARE.x} y1={SQUARE.y} x2={PLACES[p].x} y2={PLACES[p].y + 22} stroke="#191919" strokeWidth={26} strokeLinecap="round" />
              <line x1={SQUARE.x} y1={SQUARE.y} x2={PLACES[p].x} y2={PLACES[p].y + 22} stroke={busyAt(p) ? '#ffd400' : '#2b2b2b'} strokeOpacity={busyAt(p) ? 0.35 : 1} strokeWidth={1.5} strokeDasharray="2 9" strokeLinecap="round" />
            </g>
          ))}

        {/* the square */}
        <ellipse cx={SQUARE.x} cy={SQUARE.y + 26} rx={165} ry={50} fill="#121212" stroke="#262626" />
        <ellipse cx={SQUARE.x} cy={SQUARE.y + 26} rx={145} ry={40} fill="none" stroke="#1c1c1c" strokeDasharray="3 6" />
        <text x={SQUARE.x} y={SQUARE.y + 66} textAnchor="middle" className="fill-muted/60 text-xs" style={{ fontFamily: 'var(--font-sans)' }}>
          {waiting.length ? `${waiting.length} waiting for a slot` : 'Town square'}
        </text>

        {(Object.keys(PLACES) as Place[]).map((p) => (
          <BuildingArt key={p} place={p} busy={p === 'hall' ? waiting.length > 0 : busyAt(p) > 0} selected={panel?.type === 'place' && panel.place === p} onClick={() => onSelect({ type: 'place', place: p })} />
        ))}

        {all.map((j) => (
          <Walker key={j.id} job={j} at={position(j)} selected={j.id === selectedId} onClick={() => onSelect({ type: 'agent', id: j.id })} />
        ))}
      </svg>
    </div>
  )
}

const press = (fn: () => void) => (e: KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    fn()
  }
}

function BuildingArt({ place, busy, selected, onClick }: { place: Place; busy: boolean; selected: boolean; onClick: () => void }) {
  const { x, y, name } = PLACES[place]
  const wall = '#161616'
  const edge = selected ? '#ffd400' : '#363636'
  const roof = '#1e1e1e'
  const lit = busy ? '#ffd400' : '#252525'
  const win = (wx: number, wy: number, w = 10, h = 13) => <rect x={wx} y={wy} width={w} height={h} rx={1.5} fill={lit} opacity={busy ? 0.85 : 1} className={busy ? 'town-flicker' : undefined} />
  const door = <rect x={x - 9} y={y - 22} width={18} height={22} rx={2} fill="#000000" stroke={edge} />
  const columns = (left: number, n: number, gap: number, top: number) =>
    Array.from({ length: n }, (_, i) => <rect key={i} x={left + i * gap} y={top} width={7} height={y - top} fill="#1b1b1b" stroke={edge} strokeWidth={0.8} />)

  let art: ReactNode
  switch (place) {
    case 'observatory':
      art = (
        <>
          <rect x={x - 46} y={y - 62} width={92} height={62} fill={wall} stroke={edge} />
          <path d={`M${x - 40} ${y - 62} a40 40 0 0 1 80 0z`} fill={roof} stroke={edge} />
          <line x1={x + 4} y1={y - 88} x2={x + 46} y2={y - 118} stroke={edge} strokeWidth={7} strokeLinecap="round" />
          <circle cx={x + 50} cy={y - 121} r={2.5} fill={busy ? '#2e9bff' : '#363636'} />
          {win(x - 34, y - 44)}
          {win(x + 24, y - 44)}
        </>
      )
      break
    case 'library':
      art = (
        <>
          <polygon points={`${x - 70},${y - 74} ${x},${y - 112} ${x + 70},${y - 74}`} fill={roof} stroke={edge} />
          <rect x={x - 66} y={y - 74} width={132} height={10} fill={wall} stroke={edge} />
          {columns(x - 58, 6, 23.5, y - 64)}
          <rect x={x - 72} y={y - 4} width={144} height={6} fill={wall} stroke={edge} />
          <circle cx={x} cy={y - 90} r={7} fill={lit} />
        </>
      )
      break
    case 'faculty_hall':
      art = (
        <>
          <rect x={x - 56} y={y - 64} width={84} height={64} fill={wall} stroke={edge} />
          <polygon points={`${x - 60},${y - 64} ${x - 14},${y - 94} ${x + 32},${y - 64}`} fill={roof} stroke={edge} />
          <rect x={x + 28} y={y - 100} width={30} height={100} fill={wall} stroke={edge} />
          <polygon points={`${x + 24},${y - 100} ${x + 43},${y - 128} ${x + 62},${y - 100}`} fill={roof} stroke={edge} />
          <path d={`M${x + 37} ${y - 70} v-10 a6 6 0 0 1 12 0 v10z`} fill={lit} />
          {win(x - 46, y - 48)}
          {win(x - 28, y - 48)}
        </>
      )
      break
    case 'bank':
      art = (
        <>
          <polygon points={`${x - 64},${y - 70} ${x},${y - 102} ${x + 64},${y - 70}`} fill={roof} stroke={edge} />
          <rect x={x - 60} y={y - 70} width={120} height={9} fill={wall} stroke={edge} />
          {columns(x - 52, 5, 26, y - 61)}
          <circle cx={x} cy={y - 82} r={8} fill="none" stroke={busy ? '#ffe066' : edge} strokeWidth={1.5} />
          <text x={x} y={y - 78} textAnchor="middle" fontSize={10} fill={busy ? '#ffe066' : '#4d4d4d'} style={{ fontFamily: 'var(--font-mono)' }}>
            $
          </text>
        </>
      )
      break
    case 'admissions':
      art = (
        <>
          <rect x={x - 70} y={y - 66} width={140} height={66} fill={wall} stroke={edge} />
          <rect x={x - 76} y={y - 74} width={152} height={8} fill={roof} stroke={edge} />
          <line x1={x + 54} y1={y - 74} x2={x + 54} y2={y - 112} stroke={edge} strokeWidth={1.5} />
          <path d={`M${x + 54} ${y - 112} h22 l-6 7 l6 7 h-22z`} fill={busy ? '#ff6259' : '#2b2b2b'} />
          <circle cx={x} cy={y - 46} r={11} fill="none" stroke={busy ? '#ffd400' : edge} strokeWidth={1.5} />
          {win(x - 56, y - 50)}
          {win(x - 38, y - 50)}
          {win(x + 28, y - 50)}
          {win(x + 46, y - 50)}
        </>
      )
      break
    case 'studio':
      art = (
        <>
          <rect x={x - 48} y={y - 58} width={96} height={58} fill={wall} stroke={edge} />
          <polygon points={`${x - 54},${y - 58} ${x},${y - 96} ${x + 54},${y - 58}`} fill={roof} stroke={edge} />
          <rect x={x + 22} y={y - 92} width={10} height={20} fill={wall} stroke={edge} />
          {busy && <circle cx={x + 27} cy={y - 100} r={4} fill="#a1a1a1" opacity={0.25} className="town-smoke" />}
          <rect x={x - 38} y={y - 46} width={26} height={20} rx={1.5} fill={lit} opacity={busy ? 0.85 : 1} />
          {win(x + 22, y - 46)}
        </>
      )
      break
    case 'hall':
      art = (
        <>
          <rect x={x - 82} y={y - 56} width={164} height={56} fill={wall} stroke={edge} />
          <polygon points={`${x - 88},${y - 56} ${x},${y - 80} ${x + 88},${y - 56}`} fill={roof} stroke={edge} />
          <rect x={x - 16} y={y - 120} width={32} height={46} fill={wall} stroke={edge} />
          <polygon points={`${x - 20},${y - 120} ${x},${y - 140} ${x + 20},${y - 120}`} fill={roof} stroke={edge} />
          <circle cx={x} cy={y - 101} r={9} fill="#000000" stroke="#ffd400" strokeWidth={1.5} />
          <line x1={x} y1={y - 101} x2={x} y2={y - 107} stroke="#ffd400" strokeWidth={1.5} strokeLinecap="round" />
          <line x1={x} y1={y - 101} x2={x + 4} y2={y - 99} stroke="#ffd400" strokeWidth={1.5} strokeLinecap="round" />
          {win(x - 66, y - 40)}
          {win(x - 46, y - 40)}
          {win(x + 36, y - 40)}
          {win(x + 56, y - 40)}
        </>
      )
      break
  }

  const top = place === 'faculty_hall' ? y - 128 : place === 'observatory' ? y - 124 : place === 'hall' ? y - 140 : y - 112
  return (
    <g role="button" tabIndex={0} aria-label={`${name}: send an agent`} onClick={onClick} onKeyDown={press(onClick)} className="town-building cursor-pointer outline-none">
      {busy && <ellipse cx={x} cy={y - 40} rx={110} ry={80} fill="url(#town-glow)" />}
      {art}
      {door}
      <text x={place === 'hall' ? x + 30 : x} y={place === 'hall' ? y - 112 : top - 12} textAnchor={place === 'hall' ? 'start' : 'middle'} fontSize={13} fill={selected ? '#ffd400' : '#ffffff'} style={{ fontFamily: 'var(--font-display)' }}>
        {name}
      </text>
    </g>
  )
}

function Walker({ job, at, selected, onClick }: { job: Job; at: { x: number; y: number }; selected: boolean; onClick: () => void }) {
  const role = ROLE[job.role] ?? ROLE.researcher
  const side = job.status === 'working' ? (PLACES[job.building]?.side ?? 1) : 1
  const gone = !isActive(job)
  const text = job.status === 'working' ? lastLine(job) : ''
  return (
    <g
      style={{ transform: `translate(${at.x}px, ${at.y}px)`, transition: 'transform 2.4s cubic-bezier(.45,.05,.35,1), opacity 1.2s', opacity: gone ? 0.35 : 1 }}
      role="button"
      tabIndex={0}
      aria-label={`${job.agent}, ${role.label.toLowerCase()}: ${STATUS[job.status].label}`}
      onClick={onClick}
      onKeyDown={press(onClick)}
      className="cursor-pointer outline-none"
    >
      <g className={job.status === 'working' ? 'town-bob' : undefined}>
        <ellipse cx={0} cy={14} rx={11} ry={3.5} fill="#000" opacity={0.45} />
        {job.status === 'working' && <circle r={17} fill="none" stroke={role.color} strokeOpacity={0.5} className="town-pulse" />}
        {selected && <circle r={18} fill="none" stroke="#ffd400" strokeWidth={2} />}
        <circle r={12} fill={role.color} opacity={job.status === 'waiting' ? 0.55 : 1} stroke="#000000" strokeWidth={2} />
        {job.model && <circle cx={9} cy={-9} r={4} fill="#ffd400" stroke="#000000" strokeWidth={1.5} />}
        <text y={4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#141000" style={{ fontFamily: 'var(--font-sans)' }}>
          {job.agent[0]}
        </text>
      </g>
      {text && (
        <foreignObject x={side === 1 ? 20 : -230} y={-34} width={210} height={56} style={{ overflow: 'visible', pointerEvents: 'none' }}>
          <div className={cx('flex', side === 1 ? 'justify-start' : 'justify-end')}>
            <div className="max-w-[210px] rounded-lg border border-line-strong bg-panel-2/95 px-2.5 py-1.5 text-xs leading-snug text-text shadow-lg shadow-black/40">
              <div className="font-medium" style={{ color: role.color }}>
                {job.agent}
              </div>
              <div className="line-clamp-2 text-text/80">{text}</div>
            </div>
          </div>
        </foreignObject>
      )}
    </g>
  )
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
      {(Object.keys(ROLE) as Role[]).map((r) => (
        <span key={r} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: ROLE[r].color }} />
          {ROLE[r].label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-live ring-2 ring-black" />
        on Opus
      </span>
      <span>Faded: waiting for a slot</span>
    </div>
  )
}

// ------------------------------------------------------------------ side panels

function PanelShell({ title, sub, onClose, children }: { title: ReactNode; sub?: ReactNode; onClose?: () => void; children: ReactNode }) {
  return (
    <Card
      title={
        <span className="block">
          <span className="font-display text-lg font-medium">{title}</span>
          {sub && <span className="block text-xs font-normal text-muted">{sub}</span>}
        </span>
      }
      actions={
        onClose && (
          <button onClick={onClose} className="grid h-7 w-7 place-items-center rounded-md text-lg leading-none text-muted hover:bg-panel-2 hover:text-text" aria-label="Close panel">
            ×
          </button>
        )
      }
    >
      {children}
    </Card>
  )
}

function AgentPanel({ job, jobs, now, onClose, onSelect }: { job: Job; jobs: Job[]; now: number; onClose: () => void; onSelect: (id: string) => void }) {
  const { cancelJob, apps } = useData()
  const role = ROLE[job.role] ?? ROLE.researcher
  const app = job.params?.app_id ? apps.find((a) => a.id === job.params!.app_id) : undefined
  const team = job.mission ? jobs.filter((j) => j.mission?.id === job.mission!.id && j.id !== job.id) : []
  const waitingOn = (job.depends_on ?? []).map((id) => jobs.find((j) => j.id === id)).filter((j): j is Job => !!j && isActive(j))
  const logRef = useRef<HTMLOListElement>(null)
  const [stopping, setStopping] = useState(false)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [job.activity?.length, job.id])
  useEffect(() => setStopping(false), [job.id])

  const since = job.status === 'working' ? `working for ${ago(now - ts(job.started))}` : job.status === 'waiting' ? `waiting ${ago(now - ts(job.created))}` : job.finished ? `finished ${formatDate(job.finished.slice(0, 10))}, took ${ago(ts(job.finished) - ts(job.started ?? job.created))}` : ''

  return (
    <PanelShell
      title={
        <span className="inline-flex items-center gap-2">
          <span className="h-3 w-3 rounded-full" style={{ background: role.color }} />
          {job.agent}
        </span>
      }
      sub={`${role.label} at the ${PLACES[job.building]?.name ?? job.building}`}
      onClose={onClose}
    >
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={STATUS[job.status].cls}>{STATUS[job.status].label}</Badge>
          {job.model && <Tag tone="yellow">Opus</Tag>}
          <span className="text-xs text-muted">{since}</span>
        </div>

        <div>
          <div className="text-text">{job.kind === 'discover' ? `Searching: “${job.params?.query ?? job.label}”` : job.label}</div>
          {app && (
            <Link to={appPath(app)} className="text-xs text-live hover:underline">
              Open {app.kind === 'program' ? app.university : app.name}
            </Link>
          )}
        </div>

        {job.result_summary && job.status === 'done' && <p className="rounded-lg bg-ok/5 px-3 py-2 text-ok ring-1 ring-ok/20">{job.result_summary}</p>}
        {job.error && <p className="rounded-lg bg-danger/5 px-3 py-2 text-danger ring-1 ring-danger/20">{job.error}</p>}
        {waitingOn.length > 0 && <p className="text-xs text-muted">Waiting for {waitingOn.map((j) => j.agent).join(', ')} to report back before starting.</p>}

        <div>
          <Label hint={`${job.activity?.length ?? 0} entries`}>Activity</Label>
          <ol ref={logRef} className="max-h-80 space-y-1.5 overflow-y-auto rounded-lg border border-line bg-bg p-3">
            {(job.activity ?? []).map((a, i, list) => (
              <li key={i} className={cx('flex gap-2.5 text-xs leading-relaxed', i === list.length - 1 && isActive(job) ? 'text-text' : 'text-muted')}>
                <span className="num shrink-0 text-muted/60">{a.at.slice(11, 19)}</span>
                <span className="min-w-0 break-words">{a.text}</span>
              </li>
            ))}
          </ol>
        </div>

        {job.mission && (
          <div>
            <Label>{job.mission.label}</Label>
            <div className="space-y-1">
              {team.length === 0 && <p className="text-xs text-muted">Working alone on this one.</p>}
              {team.map((t) => (
                <button key={t.id} onClick={() => onSelect(t.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-panel-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: ROLE[t.role]?.color }} />
                  <span className="text-text">{t.agent}</span>
                  <span className="text-muted">{ROLE[t.role]?.label.toLowerCase()}</span>
                  <span className="ml-auto text-muted">{STATUS[t.status].label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {isActive(job) && (
          <Button
            variant="danger"
            className="w-full"
            loading={stopping}
            onClick={() => {
              setStopping(true)
              cancelJob(job.id)
            }}
          >
            {job.status === 'working' ? `Call ${job.agent} back` : `Send ${job.agent} home`}
          </Button>
        )}
      </div>
    </PanelShell>
  )
}

function HistoryPanel({ history, now, onSelect }: { history: Job[]; now: number; onSelect: (id: string) => void }) {
  return (
    <PanelShell title="Town records" sub="Agents who have finished, newest first">
      {history.length === 0 ? (
        <p className="text-sm text-muted">No one has finished a job yet. Click a building on the map to send the first agent.</p>
      ) : (
        <ol className="-mx-2 max-h-[640px] space-y-px overflow-y-auto">
          {history.slice(0, 60).map((j) => (
            <li key={j.id}>
              <button onClick={() => onSelect(j.id)} className="flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left hover:bg-panel-2">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: ROLE[j.role]?.color ?? '#a1a1a1' }} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm text-text">
                      {j.agent} <span className="text-muted">on {j.kind === 'discover' ? 'search' : j.label}</span>
                    </span>
                    <span className="num shrink-0 text-xs text-muted">{j.finished ? (now - ts(j.finished) < 86400000 ? `${ago(now - ts(j.finished))} ago` : formatDate(j.finished.slice(0, 10))) : ''}</span>
                  </span>
                  <span className={cx('block truncate text-xs', j.status === 'error' ? 'text-danger' : j.status === 'done' ? 'text-muted' : 'text-muted/70')}>
                    {j.status === 'done' ? (j.result_summary ?? 'Done') : j.status === 'error' ? (j.error ?? 'Failed') : 'Stood down'}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </PanelShell>
  )
}

// ------------------------------------------------------------------ dispatch menus

function PlacePanel({ place, jobs, onClose, onSelect }: { place: Place; jobs: Job[]; onClose: () => void; onSelect: (id: string) => void }) {
  const spot = PLACES[place]
  const here = place === 'hall' ? jobs.filter((j) => j.status === 'waiting') : jobs.filter((j) => j.building === place)
  return (
    <PanelShell title={spot.name} sub={spot.does} onClose={onClose}>
      <div className="space-y-5">
        {here.length > 0 && (
          <div>
            <Label>{place === 'hall' ? 'Waiting in the square' : 'Here now'}</Label>
            <div className="space-y-1">
              {here.map((j) => (
                <button key={j.id} onClick={() => onSelect(j.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-panel-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: ROLE[j.role]?.color }} />
                  <span className="text-text">{j.agent}</span>
                  <span className="truncate text-muted">{j.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <Dispatch place={place} onSent={(id) => id && onSelect(id)} />
      </div>
    </PanelShell>
  )
}

function useTargets() {
  const { apps } = useData()
  return useMemo(() => {
    const live = apps.filter((a) => !a.archived)
    const label = (a: Application) => (a.kind === 'program' ? `${a.university}, ${a.name}` : a.name)
    const sort = (list: Application[]) => [...list].sort((a, b) => label(a).localeCompare(label(b)))
    return { all: sort(live), programs: sort(live.filter((a) => a.kind === 'program')), label }
  }, [apps])
}

function Dispatch({ place, onSent }: { place: Place; onSent: (id?: string) => void }) {
  const { runJob, runMission, busyApp, meta, toast } = useData()
  const { all, programs, label } = useTargets()
  const [appId, setAppId] = useState('')
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<'program' | 'scholarship'>('program')
  const [url, setUrl] = useState('')
  const [sending, setSending] = useState(false)

  const pool = place === 'library' || place === 'hall' ? all : programs
  const target = pool.find((a) => a.id === appId)
  useEffect(() => setUrl(target?.faculty_source_url ?? ''), [target?.id, target?.faculty_source_url])
  const off = !meta?.ai_configured

  /** Start a job, then show the new agent; tracking (and the result toast) carries on in the background. */
  const send = (start: (strong: boolean) => Promise<Job<unknown>>) => {
    setSending(true)
    let dispatched: (id?: string) => void = () => undefined
    new Promise<string | undefined>((r) => (dispatched = r)).then((id) => {
      setSending(false)
      onSent(id)
    })
    runJob(async (strong) => {
      try {
        const job = await start(strong)
        dispatched(job.id)
        return job
      } catch (e) {
        dispatched()
        throw e
      }
    }).catch(() => undefined)
  }

  const sendTeam = (force: boolean) => {
    if (target) runMission(target.id, { force }).catch(() => undefined)
  }

  const picker = (
    <div>
      <Label>{place === 'library' || place === 'hall' ? 'Program or scholarship' : 'Program'}</Label>
      <Select value={appId} onChange={(e) => setAppId(e.target.value)}>
        <option value="">Choose…</option>
        {pool.map((a) => (
          <option key={a.id} value={a.id}>
            {label(a)}
          </option>
        ))}
      </Select>
      {target && busyApp(target.id) && <p className="mt-1.5 text-xs text-warn">{busyApp(target.id)!.agent} is already working on this.</p>}
    </div>
  )
  const footer = (button: ReactNode) => (
    <div className="flex items-center justify-between gap-2 pt-1">
      <OpusToggle />
      {button}
    </div>
  )

  switch (place) {
    case 'observatory':
      return (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (query.trim()) send((strong) => api.discover(query.trim(), kind, strong))
          }}
        >
          <div>
            <Label>What should the scout look for?</Label>
            <Textarea rows={3} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Funded ML master's in Germany with an English track" />
          </div>
          <Select value={kind} onChange={(e) => setKind(e.target.value as 'program' | 'scholarship')}>
            <option value="program">Programs</option>
            <option value="scholarship">Scholarships</option>
          </Select>
          {footer(
            <Button variant="primary" type="submit" loading={sending} disabled={off || !query.trim()}>
              Send a scout
            </Button>,
          )}
          <p className="text-xs text-muted">
            Results land on the <Link to="/discover" className="text-live hover:underline">Discover</Link> page.
          </p>
        </form>
      )
    case 'library':
    case 'hall':
      return (
        <div className="space-y-3">
          {picker}
          <p className="text-xs leading-relaxed text-muted">
            A research team is a researcher, an accountant and a recruiter working in parallel, then an assessor who scores the result. Parts researched in the last 30 days are skipped.
          </p>
          {footer(
            <div className="flex gap-2">
              {place === 'library' && (
                <Button size="sm" loading={sending} disabled={off || !target} onClick={() => send((strong) => api.research(target!.id, strong))}>
                  Profile only
                </Button>
              )}
              <Button size="sm" variant="primary" loading={sending} disabled={off || !target} onClick={() => sendTeam(false)}>
                Send research team
              </Button>
            </div>,
          )}
          {target?.researched_on && (
            <button className="text-xs text-muted hover:text-text" disabled={off} onClick={() => sendTeam(true)}>
              Researched {formatDate(target.researched_on)}. Research everything again
            </button>
          )}
        </div>
      )
    case 'faculty_hall':
      return (
        <div className="space-y-3">
          {picker}
          <div>
            <Label hint="supervisor or faculty list">Directory page</Label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-text outline-none placeholder:text-muted/50 focus:border-live/70"
            />
          </div>
          {footer(
            <Button
              variant="primary"
              size="sm"
              loading={sending}
              disabled={off || !target || !url.trim()}
              onClick={() => (url.trim().startsWith('http') ? send((strong) => api.fetchFaculty(target!.id, url.trim(), strong)) : toast('The directory link should start with http', 'error'))}
            >
              Send a recruiter
            </Button>,
          )}
        </div>
      )
    case 'bank':
      return (
        <div className="space-y-3">
          {picker}
          {footer(
            <Button variant="primary" size="sm" loading={sending} disabled={off || !target} onClick={() => send((strong) => api.researchFunding(target!.id, strong))}>
              Send an accountant
            </Button>,
          )}
        </div>
      )
    case 'admissions':
      return (
        <div className="space-y-3">
          {picker}
          {target && !target.researched_on && <p className="text-xs text-warn">Not researched yet, so the score will rest on very little. Send a research team first.</p>}
          {footer(
            <Button variant="primary" size="sm" loading={sending} disabled={off || !target} onClick={() => send((strong) => api.score(target!.id, strong))}>
              Send an assessor
            </Button>,
          )}
        </div>
      )
    case 'studio':
      return (
        <div className="space-y-3">
          {picker}
          {footer(
            <Button variant="primary" size="sm" loading={sending} disabled={off || !target} onClick={() => send((strong) => api.sopOutline(target!.id, strong))}>
              Ask for structure
            </Button>,
          )}
          <p className="text-xs text-muted">
            For a draft review, open the{' '}
            <Link to={target ? applyPath(target, 'essay:sop') : '/apply'} className="text-live hover:underline">
              essay in Apply
            </Link>{' '}
            so the coach reads your latest text.
          </p>
        </div>
      )
  }
}
