import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, type Application, type Profile, type Scores, type Stage } from '../api'
import { useData } from '../data'
import { appPath, countdown, cx, formatDate, fullName, money, nextDeadline, shortDate, shortName, STAGES, stageInfo, urgencyClass, weightedScore } from '../lib'
import { APPLY_STAGES, applyPath, inApply } from '../applyTasks'
import NewApplication from '../components/NewApplication'
import OpusToggle from '../components/OpusToggle'
import { Button, Chevron, Empty, Input, Markdown, Modal, PageHeader, Spinner, StageBadge, Tag, TierBadge, ViewSwitch } from '../components/ui'
import { StageSelect } from '../components/ProgramTabs'

type View = 'cards' | 'board' | 'compare'
const KEYS = ['fit', 'cost', 'admit', 'career'] as const
type Key = (typeof KEYS)[number]
const KEY_LABEL: Record<Key, string> = { fit: 'Fit', cost: 'Cost', admit: 'Admit', career: 'Career' }
const KEY_LONG: Record<Key, string> = { fit: 'Profile fit', cost: 'Cost and funding', admit: 'Chance of admission', career: 'Career outcomes' }
const DEFAULT_WEIGHTS = { fit: 35, cost: 25, admit: 20, career: 20 }

/** Programs still being decided on (Researching, Shortlisted), as cards, a stage board, or a ranked comparison. Ones you're applying to live in
 *  Apply, but Compare includes them too so they can be weighed against the rest. */
const RESEARCH_STAGES: Stage[] = ['researching', 'shortlisted']
// The board's last column hands a program over to Apply: dropping a card there starts applying.
// Not considering sits after it, so dropped programs are one drag away from coming back.
const BOARD = [...STAGES.filter((s) => RESEARCH_STAGES.includes(s.id)), { ...stageInfo('preparing'), label: 'Applying' }, stageInfo('dropped')]
const column = (a: Application): Stage | null =>
  a.stage === 'dropped' ? 'dropped' : inApply(a) ? 'preparing' : RESEARCH_STAGES.includes(a.stage) ? a.stage : null

export default function Applications() {
  const { apps, profile } = useData()
  const [params, setParams] = useSearchParams()
  const view = (['cards', 'board', 'compare'].includes(params.get('view') ?? '') ? params.get('view') : 'cards') as View
  const stage = (params.get('stage') ?? '') as Stage | ''
  const archived = params.get('archived') === '1'
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const weights = profile?.shortlist_weights ?? DEFAULT_WEIGHTS

  const set = (k: string, v: string | null) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        if (v) n.set(k, v)
        else n.delete(k)
        return n
      },
      { replace: true },
    )

  const compare = view === 'compare'
  const programs = apps
    .filter((a) => a.kind === 'program')
    // Not considering shows when you ask for it (the checkbox, or that stage in the filter). Compare also shows what you're applying to.
    .filter((a) => RESEARCH_STAGES.includes(a.stage) || (compare && inApply(a)) || ((archived || stage === 'dropped') && a.stage === 'dropped'))
    .filter((a) => !stage || a.stage === stage)
    .filter((a) => !q || `${a.university} ${a.name} ${a.city} ${a.country}`.toLowerCase().includes(q.toLowerCase()))
  const total = apps.filter((a) => a.kind === 'program' && !a.archived && RESEARCH_STAGES.includes(a.stage)).length
  const shortlisted = apps.filter((a) => a.kind === 'program' && !a.archived && a.stage === 'shortlisted').length
  const applying = apps.filter((a) => a.kind === 'program' && inApply(a)).length

  return (
    <>
      <PageHeader
        title="Applications"
        subtitle={`${total} program${total === 1 ? '' : 's'} being decided on, ${shortlisted} shortlisted. Open any of them for the full picture.`}
        actions={
          <>
            <Link to="/discover">
              <Button>Find more</Button>
            </Link>
            <Button variant="primary" onClick={() => setAdding(true)}>
              Add program
            </Button>
          </>
        }
      />

      <div className="mb-8 flex flex-wrap items-center gap-3">
        <ViewSwitch<View>
          value={view}
          onChange={(v) => set('view', v === 'cards' ? null : v)}
          views={[
            { id: 'cards', label: 'Cards' },
            { id: 'board', label: 'Board' },
            { id: 'compare', label: 'Compare' },
          ]}
        />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search programs" className="h-9 w-full sm:w-60" aria-label="Search programs" />
        {view !== 'board' && (
          <select value={stage} onChange={(e) => set('stage', e.target.value || null)} className="h-9 rounded-md border border-line-strong bg-bg px-2.5 text-sm" aria-label="Filter by stage">
            <option value="">Every stage</option>
            {STAGES.filter((s) => RESEARCH_STAGES.includes(s.id) || (compare && APPLY_STAGES.includes(s.id)) || s.id === 'dropped').map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        )}
        {view !== 'board' && <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={archived} onChange={(e) => set('archived', e.target.checked ? '1' : null)} className="h-4 w-4 accent-[var(--color-live)]" />
          Include not considering
        </label>}
      </div>

      {applying > 0 && view !== 'board' && (
        <p className="mb-6 border-l-2 border-live pl-4 text-sm text-muted">
          {compare ? `The ${applying} you're applying to are ranked here too; their work lives in Apply.` : `You're applying to ${applying} more. They live in Apply now.`}{' '}
          <Link to="/apply" className="text-live hover:underline">
            Open Apply
          </Link>
        </p>
      )}

      {total === 0 && applying === 0 ? (
        <Empty title="No programs yet" action={<Link to="/discover"><Button variant="primary">Find programs</Button></Link>}>
          Find programs on Discover or add one yourself.
        </Empty>
      ) : view === 'cards' ? (
        <Cards programs={programs} weights={weights} filtered={!!(q || stage)} />
      ) : view === 'board' ? (
        <Board query={q} />
      ) : (
        <Compare programs={programs} weights={weights} />
      )}
      <NewApplication open={adding} onClose={() => setAdding(false)} kind="program" />
    </>
  )
}

// ================================================================== cards

function Cards({ programs, weights, filtered }: { programs: Application[]; weights: Profile['shortlist_weights']; filtered: boolean }) {
  if (programs.length === 0) return <p className="text-sm text-muted">{filtered ? 'No programs match. Clear the search or stage filter.' : 'Nothing here.'}</p>
  const countries = [...new Set(programs.map((a) => a.country || 'Other'))].sort()
  return (
    <div className="space-y-12">
      {countries.map((c) => {
        const rows = programs.filter((a) => (a.country || 'Other') === c).sort((a, b) => (a.university ?? '').localeCompare(b.university ?? ''))
        return (
          <section key={c}>
            <h2 className="mb-4 font-display text-[1.4rem]">
              {c}
              <span className="num ml-2 text-base text-muted">{rows.length}</span>
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4 4xl:grid-cols-5">
              {rows.map((a) => (
                <ProgramCard key={a.id} app={a} score={weightedScore(a, weights)} />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function ProgramCard({ app: a, score }: { app: Application; score: number | null }) {
  const nd = nextDeadline(a)
  const strong = (a.faculty_profiles ?? []).filter((f) => f.match === 'strong').length
  const facts = [a.format, a.duration, a.tuition_usd_per_year ? `${money(a.tuition_usd_per_year)} a year` : ''].filter(Boolean)
  return (
    <Link to={appPath(a)} className={cx('group flex flex-col rounded-lg border border-line bg-panel p-5 hover:border-line-strong', a.archived && 'opacity-55')}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-display text-[1.3rem] leading-tight group-hover:text-live">{fullName(a)}</h3>
          <p className="mt-1 line-clamp-2 text-sm text-text/80">{a.name}</p>
        </div>
        <ScoreFigure score={score} />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <StageSelect app={a} compact />
        <TierBadge tier={a.scores?.tier} />
        {a.archived && <Tag tone="grey">Not considering</Tag>}
      </div>
      {facts.length > 0 && <p className="mt-3 truncate text-sm text-muted">{facts.join(', ')}</p>}
      {a.overview ? <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted">{a.overview}</p> : <p className="mt-2 text-sm text-accent">Not researched yet. Open it to send the research team.</p>}
      <div className="mt-auto flex items-center gap-3 border-t border-line pt-3 text-sm">
        {nd ? (
          <span className="min-w-0 truncate">
            <span className={cx('num font-medium', urgencyClass(nd.date))}>{countdown(nd.date)}</span>
            <span className="text-muted">, {shortDate(nd.date)}</span>
          </span>
        ) : (
          <span className="text-muted">No deadline yet</span>
        )}
        {a.faculty_profiles?.length ? <span className="hidden truncate text-muted 3xl:inline">{a.faculty_profiles.length} faculty{strong ? `, ${strong} strong` : ''}</span> : null}
        <span className="ml-auto flex items-center gap-0.5 text-live opacity-80 group-hover:opacity-100">
          Open
          <Chevron />
        </span>
      </div>
    </Link>
  )
}

/** The weighted score with its label, so the number never stands alone. */
function ScoreFigure({ score }: { score: number | null }) {
  if (score === null) return <span className="shrink-0 text-right text-xs text-muted">Not scored</span>
  return (
    <span className="shrink-0 text-right" title="Weighted score out of 10 (fit, cost, admission, career)">
      <span className="num block font-display text-[1.9rem] leading-none">{score}</span>
      <span className="text-xs text-muted">score / 10</span>
    </span>
  )
}

// ================================================================== board

function Board({ query }: { query: string }) {
  const { apps, update } = useData()
  const [kind, setKind] = useState<'all' | 'program' | 'scholarship'>('all')
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<Stage | null>(null)
  const [picked, setPicked] = useState<Stage | null>(null)

  const visible = apps
    .filter((a) => (kind === 'all' || a.kind === kind) && column(a))
    .filter((a) => !query || `${a.university} ${a.name} ${a.country} ${a.provider}`.toLowerCase().includes(query.toLowerCase()))
  const count = (s: Stage) => visible.filter((a) => column(a) === s).length
  const phoneStage = picked ?? BOARD.find((s) => count(s.id) > 0)?.id ?? BOARD[0].id

  // Chrome cancels a drag if the page re-renders inside dragstart, so mark the card as dragging on the next frame.
  const startDrag = (id: string) => requestAnimationFrame(() => setDragging(id))
  const endDrag = () => {
    setDragging(null)
    setOver(null)
  }
  const drop = (s: Stage) => {
    const app = apps.find((a) => a.id === dragging)
    endDrag()
    if (app && column(app) !== s) update(app.id, { stage: s })
  }

  return (
    <>
      <div className="mb-5 flex items-center gap-3 text-sm">
        <span className="text-muted">Show</span>
        {(['all', 'program', 'scholarship'] as const).map((k) => (
          <button key={k} onClick={() => setKind(k)} className={cx('rounded-md px-2.5 py-1', kind === k ? 'bg-panel-2 text-text ring-1 ring-line-strong' : 'text-muted hover:text-text')}>
            {k === 'all' ? 'Everything' : k === 'program' ? 'Programs' : 'Scholarships'}
          </button>
        ))}
        <span className="ml-auto hidden text-muted md:inline">Drag a card to change its stage. Applying starts applying; Not considering sets it aside.</span>
      </div>

      {/* phone: one stage at a time */}
      <div className="md:hidden">
        <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist" aria-label="Stages">
          {BOARD.map((s) => (
            <button key={s.id} role="tab" aria-selected={phoneStage === s.id} onClick={() => setPicked(s.id)} className={cx('flex shrink-0 items-center gap-2 rounded-full px-3.5 py-2 text-sm whitespace-nowrap ring-1', phoneStage === s.id ? 'bg-panel-2 text-text ring-line-strong' : 'text-muted ring-line')}>
              <span className={cx('h-2 w-2 rounded-full', s.dot)} />
              {s.label}
              <span className="num text-xs text-muted">{count(s.id)}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-3">
          {visible
            .filter((a) => column(a) === phoneStage)
            .map((a) => (
              <div key={a.id} className="rounded-lg border border-line bg-panel">
                <BoardCard app={a} bare />
                <label className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-sm text-muted">
                  Move to
                  <select value={column(a) ?? a.stage} onChange={(e) => update(a.id, { stage: e.target.value as Stage })} className="h-9 rounded-md border border-line-strong bg-bg px-2 text-sm text-text">
                    {BOARD.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ))}
          {count(phoneStage) === 0 && <p className="rounded-lg border border-dashed border-line px-3 py-10 text-center text-sm text-muted">Nothing in {(BOARD.find((b) => b.id === phoneStage)?.label ?? '').toLowerCase()} yet.</p>}
        </div>
      </div>

      {/* desktop: every stage. Nothing changes size while you drag, so the board never shifts under the cursor;
          empty stages stay slim strips and light up when a card is over them. */}
      <div className="hidden gap-3 md:flex">
        {BOARD.map((s) => {
          const cards = visible.filter((a) => column(a) === s.id)
          const empty = cards.length === 0
          const isOver = over === s.id && dragging !== null
          return (
            <div
              key={s.id}
              onDragEnter={(e) => {
                if (!dragging) return
                e.preventDefault()
                setOver(s.id)
              }}
              onDragOver={(e) => {
                if (!dragging) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                if (over !== s.id) setOver(s.id)
              }}
              onDragLeave={(e) => {
                // Moving onto a card or label inside the column also fires dragleave; only clear when leaving the column.
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === s.id ? null : o))
              }}
              onDrop={(e) => {
                e.preventDefault()
                drop(s.id)
              }}
              title={empty ? `${s.label}: drop a card here` : undefined}
              className={cx(
                'flex min-h-[65vh] flex-col rounded-lg transition-colors duration-100',
                empty ? 'w-14 shrink-0' : 'min-w-0 flex-1 basis-0',
                isOver ? 'bg-live/10 ring-2 ring-live' : 'bg-panel/60',
              )}
            >
              {empty ? (
                <div className="pointer-events-none flex flex-col items-center gap-3 pt-4 text-sm text-muted">
                  <span className={cx('h-2 w-2 rounded-full', s.dot)} />
                  <span className={cx('[writing-mode:vertical-rl]', isOver && 'text-text')}>{s.label}</span>
                </div>
              ) : (
                <>
                  <div className="pointer-events-none flex items-center gap-2 px-3 pt-3.5 pb-2">
                    <Tag family="stage" value={s.id}>
                      {s.label}
                    </Tag>
                    <span className="num ml-auto text-sm text-muted">{cards.length}</span>
                  </div>
                  <div className="flex flex-1 flex-col gap-2.5 p-2.5 pt-1">
                    {cards.map((a) => (
                      <BoardCard key={a.id} app={a} onDragStart={() => startDrag(a.id)} onDragEnd={endDrag} dragging={dragging === a.id} />
                    ))}
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

/** A card on the board: drag it anywhere, click it to open. The title is a real link for keyboard and new-tab use. */
function BoardCard({ app, onDragStart, onDragEnd, dragging, bare }: { app: Application; onDragStart?: () => void; onDragEnd?: () => void; dragging?: boolean; bare?: boolean }) {
  const navigate = useNavigate()
  const nd = nextDeadline(app)
  const to = inApply(app) ? applyPath(app) : appPath(app)
  return (
    <div
      draggable={!bare}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', app.id) // Firefox won't start a drag without data
        onDragStart?.()
      }}
      onDragEnd={onDragEnd}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('a')) navigate(to)
      }}
      className={cx('group block p-4 select-none', !bare && 'cursor-grab rounded-lg border border-line bg-panel-2 hover:border-line-strong active:cursor-grabbing', dragging && 'opacity-40', app.archived && 'opacity-50')}
    >
      <Link to={to} draggable={false} className="block font-display text-[1.1rem] leading-snug group-hover:text-live">
        {fullName(app)}
      </Link>
      <div className="mt-0.5 line-clamp-2 text-sm text-muted">{app.kind === 'program' ? app.name : app.provider}</div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {app.kind === 'scholarship' && <Tag family="kind" value="scholarship" />}
        <TierBadge tier={app.scores?.tier} />
        {app.decision && <Tag family="decision" value={app.decision} />}
        {app.response && <Tag family="response" value={app.response} />}
        {app.country && <span className="text-xs text-muted">{app.country}</span>}
      </div>
      <div className="mt-3 text-right">
        <span className={cx('num text-xs', nd ? urgencyClass(nd.date) : 'text-muted')}>{nd ? countdown(nd.date) : 'No date'}</span>
      </div>
    </div>
  )
}

// ================================================================== compare (the old shortlist)

const GROUPS = [
  { tier: 'reach', title: 'Reach', note: 'Worth a shot, unlikely to admit' },
  { tier: 'target', title: 'Target', note: 'A fair chance' },
  { tier: 'safety', title: 'Safety', note: 'Likely admits' },
  { tier: undefined, title: 'Not scored yet', note: 'Score these to place them' },
] as const

function Compare({ programs: all, weights }: { programs: Application[]; weights: Profile['shortlist_weights'] }) {
  const { profile, setProfile, update, runJob, runningJob, meta, toast } = useData()
  const [open, setOpen] = useState<string | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [comparing, setComparing] = useState(false)
  const [weightsOpen, setWeightsOpen] = useState(false)
  const programs = useMemo(() => [...all].sort((a, b) => (weightedScore(b, weights) ?? -1) - (weightedScore(a, weights) ?? -1)), [all, weights])
  const scored = (a: Application) => typeof a.scores?.fit === 'number'
  const unscored = programs.filter((a) => !scored(a))
  const sum = KEYS.reduce((t, k) => t + weights[k], 0) || 1

  const score = (a: Application) => {
    if (!runningJob('score', a.id)) runJob((strong) => api.score(a.id, strong)).catch(() => undefined)
  }
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const setWeight = (k: Key, v: number) => {
    if (!profile) return
    const next: Profile = { ...profile, shortlist_weights: { ...weights, [k]: v } }
    setProfile(next)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => api.saveProfile(next).catch((e) => toast((e as Error).message, 'error')), 600)
  }
  const toggle = (id: string) => setPicked((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length >= 4 ? c : [...c, id]))
  const compared = picked.map((id) => all.find((a) => a.id === id)).filter(Boolean) as Application[]

  return (
    <>
      <div className="mb-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <button onClick={() => setWeightsOpen((o) => !o)} className="flex w-full items-baseline justify-between gap-4 text-left lg:pointer-events-none" aria-expanded={weightsOpen}>
            <h2 className="mb-1 font-display text-[1.25rem]">How the score is weighted</h2>
            <span className="text-sm text-live lg:hidden">{weightsOpen ? 'Hide' : KEYS.map((k) => `${Math.round((weights[k] / sum) * 100)}`).join(' / ')}</span>
          </button>
          <div className={cx(weightsOpen ? 'block' : 'hidden', 'lg:block')}>
          <p className="mb-4 text-sm text-muted">Claude scores each program 0 to 10 on four things; the score is their weighted average. Drag to change what matters to you.</p>
          <div className="grid max-w-5xl gap-x-8 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
            {KEYS.map((k) => (
              <label key={k} className="block">
                <div className="mb-1.5 flex justify-between text-sm">
                  <span>{KEY_LONG[k]}</span>
                  <span className="num text-muted">{Math.round((weights[k] / sum) * 100)}%</span>
                </div>
                <input type="range" min={0} max={100} step={5} value={weights[k]} onChange={(e) => setWeight(k, Number(e.target.value))} className="w-full accent-[var(--color-live)]" />
              </label>
            ))}
          </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <OpusToggle />
          {unscored.length > 0 && (
            <Button disabled={!meta?.ai_configured} onClick={() => unscored.forEach(score)}>
              Score {unscored.length} unscored
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-10">
        {GROUPS.map((g) => {
          const rows = programs.filter((a) => (g.tier ? scored(a) && a.scores?.tier === g.tier : !scored(a) || !a.scores?.tier))
          if (!rows.length) return null
          return (
            <section key={g.title}>
              <div className="mb-2 flex items-baseline gap-3">
                {g.tier ? <TierBadge tier={g.tier} /> : <Tag tone="grey">Not scored</Tag>}
                <span className="text-sm text-muted">{g.note}</span>
                <span className="num ml-auto text-sm text-muted">{rows.length}</span>
              </div>
              <ul className="divide-y divide-line border-y border-line">
                {rows.map((a) => (
                  <CompareRow
                    key={a.id}
                    app={a}
                    total={weightedScore(a, weights)}
                    open={open === a.id}
                    onToggle={() => setOpen((o) => (o === a.id ? null : a.id))}
                    picked={picked.includes(a.id)}
                    onPick={() => toggle(a.id)}
                    scoring={!!runningJob('score', a.id)}
                    onScore={() => score(a)}
                    canScore={!!meta?.ai_configured}
                    update={update}
                  />
                ))}
              </ul>
            </section>
          )
        })}
      </div>

      {compared.length > 0 && (
        <div className="page-in fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-line-strong bg-panel-2 py-1.5 pr-1.5 pl-5 shadow-2xl shadow-black/60 md:bottom-8">
          <span className="text-sm whitespace-nowrap">
            <span className="num">{compared.length}</span> of 4 picked
          </span>
          <Button size="sm" variant="ghost" onClick={() => setPicked([])}>
            Clear
          </Button>
          <Button size="sm" variant="primary" onClick={() => setComparing(true)} disabled={compared.length < 2}>
            Compare side by side
          </Button>
        </div>
      )}
      <Modal open={comparing && compared.length > 0} onClose={() => setComparing(false)} title={`Comparing ${compared.length} programs`} wide>
        <SideBySide apps={compared} weights={weights} onRemove={toggle} />
      </Modal>
    </>
  )
}

function CompareRow({ app: a, total, open, onToggle, picked, onPick, scoring, onScore, canScore, update }: {
  app: Application
  total: number | null
  open: boolean
  onToggle: () => void
  picked: boolean
  onPick: () => void
  scoring: boolean
  onScore: () => void
  canScore: boolean
  update: (id: string, patch: Partial<Application>) => Promise<Application>
}) {
  const nd = nextDeadline(a)
  const s = a.scores ?? {}
  return (
    <li className={cx(open && 'bg-panel/70')}>
      <div className="flex items-center gap-4 py-4 md:gap-6 md:px-3">
        <input type="checkbox" checked={picked} onChange={onPick} aria-label={`Pick ${a.university} to compare`} title="Pick to compare (up to 4)" className="h-4 w-4 shrink-0 cursor-pointer accent-[var(--color-live)]" />
        <button onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-4 text-left md:gap-6" aria-expanded={open}>
          <div className="w-14 shrink-0 text-center">
            <div className={cx('num font-display text-[1.75rem] leading-none', total === null && 'text-muted')}>{total ?? '–'}</div>
            <div className="mt-0.5 text-[0.7rem] text-muted">score</div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-display text-[1.2rem] leading-snug">{fullName(a)}</div>
            <div className="truncate text-sm text-muted">
              {a.name}
              {a.country && `, ${a.country}`}
            </div>
          </div>
          {typeof s.fit === 'number' && (
            <dl className="hidden shrink-0 grid-cols-4 gap-5 text-center lg:grid" aria-label="Score breakdown">
              {KEYS.map((k) => (
                <div key={k} title={`${KEY_LONG[k]}: ${s[k]} of 10`}>
                  <dd className="num text-base">{s[k] ?? '–'}</dd>
                  <dt className="text-xs text-muted">{KEY_LABEL[k]}</dt>
                </div>
              ))}
            </dl>
          )}
          <div className="hidden w-32 shrink-0 text-right text-sm xl:block">{nd ? <><span className={cx('num', urgencyClass(nd.date))}>{countdown(nd.date)}</span><div className="num text-xs text-muted">{shortDate(nd.date)}</div></> : <span className="text-muted">No deadline</span>}</div>
        </button>
        <div className="hidden w-36 shrink-0 justify-end sm:flex">
          {a.stage === 'researching' ? (
            <Button size="sm" onClick={() => update(a.id, { stage: 'shortlisted' })}>
              Add to shortlist
            </Button>
          ) : (
            <StageBadge stage={a.stage} />
          )}
        </div>
        <Link to={appPath(a)} className="shrink-0 text-muted hover:text-live" aria-label={`Open ${a.university}`} title="Open">
          <Chevron />
        </Link>
      </div>
      {open && <RowDetail app={a} scoring={scoring} onScore={onScore} canScore={canScore} update={update} />}
    </li>
  )
}

function RowDetail({ app: a, scoring, onScore, canScore, update }: { app: Application; scoring: boolean; onScore: () => void; canScore: boolean; update: (id: string, patch: Partial<Application>) => Promise<Application> }) {
  const s = a.scores ?? {}
  const setScore = (k: keyof Scores, v: string) => {
    const n = v === '' ? undefined : Math.max(0, Math.min(10, Math.round(Number(v))))
    update(a.id, { scores: { ...s, [k]: n } })
  }
  return (
    <div className="grid gap-8 border-t border-line py-5 md:px-3 md:pl-[6.5rem] lg:grid-cols-[minmax(0,1fr)_320px]">
      <div>
        {s.rationale ? <Markdown>{s.rationale}</Markdown> : <p className="text-sm text-muted">No scores yet. Ask Claude to score this program against your profile, or type your own scores.</p>}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={onScore} loading={scoring} disabled={!canScore}>
            {s.scored_on ? 'Score again with Claude' : 'Score with Claude'}
          </Button>
          <Link to={appPath(a)}>
            <Button size="sm" variant="ghost">
              Open {shortName(a)}
            </Button>
          </Link>
          {a.stage === 'shortlisted' && (
            <Button size="sm" variant="ghost" onClick={() => update(a.id, { stage: 'researching' })}>
              Move back to researching
            </Button>
          )}
          {!inApply(a) && (
            <Button size="sm" variant="ghost" onClick={() => update(a.id, { stage: 'dropped' })}>
              Not considering
            </Button>
          )}
          {s.scored_on && <span className="text-sm text-muted">Scored {formatDate(s.scored_on)}</span>}
          {scoring && <Spinner className="text-live" />}
        </div>
      </div>
      <div className="space-y-5">
        <div>
          <div className="mb-2 text-sm text-muted">Your own scores (0 to 10)</div>
          <div className="grid grid-cols-4 gap-2">
            {KEYS.map((k) => (
              <label key={k} className="text-center">
                <input type="number" min={0} max={10} defaultValue={s[k] ?? ''} key={`${k}-${s[k]}`} onBlur={(e) => e.target.value !== String(s[k] ?? '') && setScore(k, e.target.value)} className="num w-full rounded-md border border-line-strong bg-bg py-1.5 text-center text-base outline-none focus:border-live/70" />
                <span className="mt-1 block text-xs text-muted">{KEY_LABEL[k]}</span>
              </label>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 text-sm text-muted">Tier</div>
          <div className="flex gap-2">
            {(['reach', 'target', 'safety'] as const).map((t) => (
              <button key={t} onClick={() => update(a.id, { scores: { ...s, tier: t } })} className={cx('flex-1 rounded-md py-1.5', s.tier === t ? 'ring-2 ring-white' : 'opacity-60 hover:opacity-100')}>
                <TierBadge tier={t} />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function SideBySide({ apps, weights, onRemove }: { apps: Application[]; weights: Profile['shortlist_weights']; onRemove: (id: string) => void }) {
  const rows: [string, (a: Application) => ReactNode][] = [
    ['Score', (a) => <span className="num font-display text-2xl">{weightedScore(a, weights) ?? '–'}</span>],
    ...KEYS.map((k) => [KEY_LONG[k], (a: Application) => <span className="num">{a.scores?.[k] ?? '–'}</span>] as [string, (a: Application) => ReactNode]),
    ['Tier', (a) => <TierBadge tier={a.scores?.tier} />],
    ['Stage', (a) => <StageBadge stage={a.stage} />],
    ['Where', (a) => [a.city, a.country].filter(Boolean).join(', ') || '–'],
    ['Length', (a) => a.duration || '–'],
    ['Next deadline', (a) => (nextDeadline(a) ? formatDate(nextDeadline(a)!.date) : '–')],
    ['Tuition a year', (a) => <span className="num">{money(a.tuition_usd_per_year)}</span>],
    ['Funding', (a) => <span className="line-clamp-4 text-text/80">{a.funding || '–'}</span>],
  ]
  return (
    <div className="-mx-1 max-h-[70vh] overflow-auto px-1">
      <table className="w-full min-w-[560px] table-fixed text-sm">
        <thead>
          <tr>
            <th className="w-36" />
            {apps.map((a) => (
              <th key={a.id} className="px-3 pb-3 text-left align-top font-normal">
                <div className="flex items-start justify-between gap-2">
                  <Link to={appPath(a)} className="font-display text-base hover:text-live">
                    {fullName(a)}
                  </Link>
                  <button className="text-muted hover:text-text" onClick={() => onRemove(a.id)} aria-label={`Remove ${a.university}`}>
                    ×
                  </button>
                </div>
                <div className="truncate text-xs text-muted">{a.name}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map(([label, render]) => (
            <tr key={label}>
              <td className="py-2.5 pr-3 align-top text-muted">{label}</td>
              {apps.map((a) => (
                <td key={a.id} className="px-3 py-2.5 align-top">
                  {render(a)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
