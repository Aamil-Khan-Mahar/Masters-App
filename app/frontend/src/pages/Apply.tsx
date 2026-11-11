import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, type Application, type DocFile, type FinalFolder, type Essay, type EssayComment, type EssayType, type EssayVersion, type RecStatus, type ResumeSection } from '../api'
import { useData } from '../data'
import { countdown, cx, daysUntil, ESSAY_TYPES, essaysFor, formatDate, fullName, money, shortName, supervisorEmail, todayISO, urgencyClass, wordLimit } from '../lib'
import { CONTACT_STATUS, docKey, docName, dueLine, earlierDeadline, firstSentence, GROUPS, inApply, isSubmitted, mainDeadline, progress, shortLabel, tasksFor, type Task, type TaskKind } from '../applyTasks'
import OpusToggle from '../components/OpusToggle'
import { CommentedTextarea, CommentsPanel, HistoryPanel, relocateComments, shiftComments, snapToWords, versionName, VersionView } from '../components/EssayTools'
import { Button, Chevron, EditableText, ExternalLink, Input, Markdown, Spinner, Textarea } from '../components/ui'
import ProgramProfile from '../components/ProgramProfile'
import RequirementsChecklist, { reqLabel } from '../components/RequirementsChecklist'
import ProgramTabs, { programTab } from '../components/ProgramTabs'
import FacultyDirectory from '../components/FacultyDirectory'
import FundingTab from '../components/FundingTab'
import { ReadOnly } from '../readOnly'
import AskClaude from '../components/AskClaude'
import Supervisors from '../components/Supervisors'
import { useHomeMoney } from '../homeMoney'

const ADD_LETTER: Task = { key: 'letters', kind: 'letters', group: 'People', title: 'Add a recommender', status: '', done: false }
/** Not a to-do: the application's Final folder, opened from the row under the to-dos. */
const FINAL: Task = { key: 'final', kind: 'final', group: 'Finish', title: 'Final folder', status: '', done: false }

/** Smart folders: one kind of to-do across every application, like saved searches in a mail client. */
const FOLDERS: { id: string; label: string; kinds: TaskKind[] }[] = [
  { id: 'documents', label: 'Documents', kinds: ['doc', 'check'] },
  { id: 'scores', label: 'Score sends', kinds: ['score'] },
  { id: 'fees', label: 'Fees', kinds: ['fee'] },
  { id: 'supervisors', label: 'Supervisors', kinds: ['contact'] },
]

/**
 * Apply mode: a calm, mail-style workspace for applications you're preparing. Applications (and smart folders) on the
 * left, one application's to-dos in the middle, the open to-do on the right (an essay opens as a full page editor).
 * Short facts only; the research lives in Research mode.
 */
export default function Apply() {
  const { apps, profile, recommenders, loading } = useData()
  const [params, setParams] = useSearchParams()
  const wide = useWide()

  const list = apps
    .filter((a) => inApply(a) || a.id === params.get('app'))
    .sort((a, b) => (mainDeadline(a)?.date ?? '9999').localeCompare(mainDeadline(b)?.date ?? '9999'))
  const folder = FOLDERS.find((f) => f.id === params.get('folder'))
  const picked = list.find((a) => a.id === params.get('app'))
  // On a big screen something is always open; on a phone you start from the list.
  const app = picked ?? (wide && !folder ? list.find((a) => !isSubmitted(a)) ?? list[0] : undefined)
  const tasks = app ? tasksFor(app, profile, recommenders) : []
  const itemKey = params.get('item')
  const task = tasks.find((t) => t.key === itemKey) ?? (app && itemKey === 'letters' ? ADD_LETTER : app && itemKey === 'final' ? FINAL : undefined)
  const keep: Record<string, string> = folder ? { folder: folder.id } : {}
  const open = (a: Application, item?: string) => setParams({ ...keep, app: a.id, ...(item ? { item } : {}) })
  const openProgram = (a: Application) => setParams({ app: a.id, page: 'program' })
  const view = folder ? (task ? 'item' : 'folder') : !app ? 'apps' : params.get('page') === 'program' ? 'program' : itemKey ? 'item' : 'tasks'
  const back = () => (view === 'item' && folder ? setParams(keep) : view === 'item' || view === 'program' ? open(app!) : setParams({}))
  const backLabel = view === 'item' && folder ? folder.label : (view === 'item' || view === 'program') && app ? shortName(app) : 'All'

  if (loading) return <p className="p-6 text-sm text-muted">Loading…</p>
  if (list.length === 0)
    return (
      <div className="mx-auto max-w-md p-10 text-center">
        <p className="font-display text-2xl">Nothing to apply to yet</p>
        <p className="mt-2 text-sm text-muted">Open a shortlisted program in Research mode and press Start applying. It opens here.</p>
        <Link to="/applications" className="mt-4 inline-block text-sm text-live hover:underline">
          Go to the shortlist
        </Link>
      </div>
    )

  return (
    <div className="flex h-full flex-col">
      {!wide && view !== 'apps' && (
        <div className="flex h-11 shrink-0 items-center border-b border-line px-4">
          <button onClick={back} className="-ml-1 flex items-center gap-1 text-sm text-muted">
            <span aria-hidden className="text-lg leading-none">‹</span> {backLabel}
          </button>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        {(wide || view === 'apps') && <AppList list={list} current={folder ? undefined : app} folder={folder?.id} onOpen={(a) => setParams({ app: a.id })} onFolder={(f) => setParams({ folder: f })} />}
        {view === 'program' && app && <ProgramPage app={app} onClose={() => open(app)} />}
        {folder && (wide || view === 'folder') && <FolderList folder={folder} list={list} current={app && task ? `${app.id}|${task.key}` : undefined} onOpen={(a, k) => open(a, k)} />}
        {!folder && app && view !== 'program' && (wide || view === 'tasks') && <TaskList app={app} tasks={tasks} current={task?.key} onOpen={(k) => open(app, k)} onProgram={() => openProgram(app)} />}
        {view !== 'program' && (wide || view === 'item') && (
          <main className="min-w-0 flex-1 overflow-y-auto">
            {app && task ? (
              <Detail key={`${app.id}:${task.key}`} app={app} task={task} tasks={tasks} onOpen={(k) => open(app, k)} />
            ) : app && !folder ? (
              <ProgramInfo app={app} onFull={() => openProgram(app)} />
            ) : (
              <p className="p-10 text-sm text-muted">Pick something on the left.</p>
            )}
          </main>
        )}
      </div>
    </div>
  )
}

function useWide() {
  const q = '(min-width: 1024px)'
  const [wide, setWide] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const m = window.matchMedia(q)
    const on = () => setWide(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return wide
}

// ---------------------------------------------------------------- left: applications and smart folders

function AppList({ list, current, folder, onOpen, onFolder }: { list: Application[]; current?: Application; folder?: string; onOpen: (a: Application) => void; onFolder: (id: string) => void }) {
  const { profile, recommenders } = useData()
  const groups = [
    { title: 'In progress', apps: list.filter((a) => !isSubmitted(a)) },
    { title: 'Submitted', apps: list.filter(isSubmitted) },
  ].filter((g) => g.apps.length)
  const all = list.flatMap((a) => tasksFor(a, profile, recommenders))
  const selected = 'bg-panel-2 before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-live'
  return (
    <nav className="w-full shrink-0 overflow-y-auto border-line pb-safe lg:w-64 lg:border-r 3xl:w-72" aria-label="Applications">
      {groups.map((g) => (
        <div key={g.title} className="py-3">
          <div className="px-5 pb-1 text-xs text-muted/70">{g.title}</div>
          {g.apps.map((a) => {
            const d = mainDeadline(a)
            const [done, total] = progress(tasksFor(a, profile, recommenders))
            return (
              <button key={a.id} onClick={() => onOpen(a)} className={cx('relative flex w-full items-center gap-3 px-5 py-3 text-left', current?.id === a.id ? selected : 'hover:bg-panel')}>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-display text-[1.1rem] leading-tight">{shortName(a)}</div>
                  <div className="mt-0.5 truncate text-xs text-muted" title={a.name}>
                    {a.kind === 'program' ? a.name : a.provider || 'Scholarship'}
                  </div>
                </div>
                <div className="num shrink-0 text-right">
                  {d && !isSubmitted(a) && <div className={cx('text-sm', urgencyClass(d.date))}>{countdown(d.date)}</div>}
                  <div className="text-xs text-muted">
                    {done}/{total}
                  </div>
                </div>
                <Chevron className="text-muted lg:hidden" />
              </button>
            )
          })}
        </div>
      ))}
      <div className="border-t border-line py-3">
        <div className="px-5 pb-1 text-xs text-muted/70">Across all</div>
        {FOLDERS.map((f) => {
          const left = all.filter((t) => f.kinds.includes(t.kind) && !t.done).length
          return (
            <button key={f.id} onClick={() => onFolder(f.id)} className={cx('relative flex w-full items-center gap-3 px-5 py-2.5 text-left text-sm', folder === f.id ? selected : 'hover:bg-panel')}>
              <span className="flex-1">{f.label}</span>
              <span className="num text-xs text-muted">{left || ''}</span>
              <Chevron className="text-muted lg:hidden" />
            </button>
          )
        })}
      </div>
    </nav>
  )
}

/** One smart folder: that kind of to-do for every application, grouped by application. */
function FolderList({ folder, list, current, onOpen }: { folder: (typeof FOLDERS)[number]; list: Application[]; current?: string; onOpen: (a: Application, key: string) => void }) {
  const { profile, recommenders } = useData()
  const [showDone, setShowDone] = useState(false)
  const rows = list.map((a) => ({ a, items: tasksFor(a, profile, recommenders).filter((t) => folder.kinds.includes(t.kind)) })).filter((r) => r.items.length)
  const done = rows.reduce((n, r) => n + r.items.filter((t) => t.done).length, 0)
  const total = rows.reduce((n, r) => n + r.items.length, 0)
  return (
    <section className="w-full shrink-0 overflow-y-auto border-line pb-safe lg:w-[22rem] lg:border-r 3xl:w-[26rem]">
      <div className="border-b border-line px-5 pt-5 pb-4">
        <h1 className="font-display text-[1.6rem] leading-tight">{folder.label}</h1>
        <p className="num mt-1 text-sm text-muted">
          {done} of {total} done across {rows.length} application{rows.length === 1 ? '' : 's'}
        </p>
      </div>
      {total === 0 && <p className="px-5 py-6 text-sm text-muted">Nothing here yet.</p>}
      {rows.map(({ a, items }) => {
        const shown = items.filter((t) => showDone || !t.done)
        if (!shown.length) return null
        return (
          <div key={a.id} className="pt-3">
            <div className="px-5 pb-1 text-xs text-muted/70">{shortName(a)}</div>
            {shown.map((t) => (
              <FolderRow key={t.key} app={a} task={t} on={current === `${a.id}|${t.key}`} onOpen={() => onOpen(a, t.key)} />
            ))}
          </div>
        )
      })}
      {done > 0 && (
        <button onClick={() => setShowDone((v) => !v)} className="w-full px-5 py-4 text-left text-xs text-muted hover:text-text">
          {showDone ? 'Hide finished' : `Show ${done} finished`}
        </button>
      )}
    </section>
  )
}

function FolderRow({ app, task, on, onOpen }: { app: Application; task: Task; on: boolean; onOpen: () => void }) {
  const setDone = useSetDone(app)
  return <TaskRow task={task} on={on} onOpen={onOpen} onToggle={canToggle(task) ? () => setDone(task, !task.done) : undefined} />
}

// ---------------------------------------------------------------- middle: one application's to-dos

function TaskList({ app, tasks, current, onOpen, onProgram }: { app: Application; tasks: Task[]; current?: string; onOpen: (key: string) => void; onProgram: () => void }) {
  const setDone = useSetDone(app)
  const [done, total] = progress(tasks)
  const d = mainDeadline(app)
  const early = earlierDeadline(app)
  const [showDone, setShowDone] = useState(false)
  return (
    <section className="w-full shrink-0 overflow-y-auto border-line pb-safe lg:w-[22rem] lg:border-r 3xl:w-[26rem]">
      <div className="border-b border-line px-5 pt-5 pb-4">
        <h1 className="font-display text-[1.6rem] leading-tight">
          <button onClick={onProgram} className="text-left hover:text-live" title="Open the full program page">
            {shortName(app)}
          </button>
        </h1>
        <p className="truncate text-sm text-muted" title={app.name}>
          {app.kind === 'program' ? app.name : app.provider}
        </p>
        <div className="mt-3 flex items-baseline justify-between gap-3 text-sm">
          <span className="truncate">{dueLine(d)}</span>
          {d && <span className={cx('num shrink-0', urgencyClass(d.date))}>{countdown(d.date)}</span>}
        </div>
        {early && (
          <div className="mt-1 flex items-baseline justify-between gap-3 text-sm text-muted">
            <span className="truncate" title={early.label}>
              Before that: {shortLabel(early.label)}
            </span>
            <span className={cx('num shrink-0', urgencyClass(early.date))}>{countdown(early.date)}</span>
          </div>
        )}
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-panel-2" role="progressbar" aria-valuenow={done} aria-valuemax={total}>
          <div className="h-full rounded-full bg-text/80" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
        </div>
        <div className="num mt-1.5 flex justify-between text-xs text-muted">
          <span>
            {done} of {total} done
          </span>
          <button onClick={onProgram} className="hover:text-live">
            Program page
          </button>
        </div>
      </div>

      {GROUPS.map((g) => {
        const items = tasks.filter((t) => t.group === g && (showDone || !t.done))
        if (!items.length) return null
        return (
          <div key={g} className="pt-3">
            <div className="px-5 pb-1 text-xs text-muted/70">{g}</div>
            {items.map((t) => (
              <TaskRow key={t.key} task={t} on={current === t.key} onOpen={() => onOpen(t.key)} onToggle={canToggle(t) ? () => setDone(t, !t.done) : undefined} />
            ))}
          </div>
        )
      })}
      <div className="mt-3 border-t border-line pt-1">
        <button
          onClick={() => onOpen('final')}
          className={cx('group relative flex w-full items-center gap-3 px-5 py-2.5 text-left', current === 'final' ? 'bg-panel-2 before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-live' : 'hover:bg-panel')}
        >
          <FolderIcon />
          <span className="min-w-0 flex-1 truncate text-[0.95rem]">Final folder</span>
          <span className="shrink-0 text-xs text-muted/80">Everything to upload</span>
          <Chevron className={cx(current === 'final' ? 'text-live' : 'text-muted/60 group-hover:text-muted')} />
        </button>
      </div>
      {done > 0 && (
        <button onClick={() => setShowDone((v) => !v)} className="w-full px-5 pt-4 text-left text-xs text-muted hover:text-text">
          {showDone ? 'Hide finished' : `Show ${done} finished`}
        </button>
      )}
      <AddBar app={app} onOpen={onOpen} />
    </section>
  )
}

/** Add a statement to an application and return its id ("question-2", "sop"...). */
function useAddEssay(app: Application) {
  const { update } = useData()
  return async (type: EssayType, extra: Partial<Essay> = {}) => {
    const list = essaysFor(app)
    const base = type === 'sop' || type === 'soi' ? type : (extra.title ? 'question' : ESSAY_TYPES[type].label.toLowerCase().replace(/[^a-z0-9]+/g, '-'))
    let id = base
    for (let n = 2; list.some((e) => e.id === id); n++) id = `${base}-${n}`
    // Saved before the editor opens, so the server knows the statement when it loads the draft.
    await update(app.id, { essays: [...list, { id, type, title: ESSAY_TYPES[type].label, prompt: '', limit: null, ...extra }] })
    return id
  }
}

/** Add a statement, a recommender or a to-do of your own. Small and out of the way. */
function AddBar({ app, onOpen }: { app: Application; onOpen: (key: string) => void }) {
  const { update, runJob, runningJob, meta } = useData()
  const [mode, setMode] = useState<'' | 'statement' | 'question' | 'todo'>('')
  const [todo, setTodo] = useState('')
  const [question, setQuestion] = useState('')
  const [qLimit, setQLimit] = useState('')
  const addEssay = useAddEssay(app)
  const finding = runningJob('ask', app.id)
  const addStatement = async (type: EssayType) => {
    const id = await addEssay(type)
    setMode('')
    onOpen(`essay:${id}`)
  }
  const addQuestion = async () => {
    const q = question.trim()
    if (!q) return
    const n = essaysFor(app).filter((e) => e.type === 'other').length + 1
    const id = await addEssay('other', { title: `Question ${n}`, prompt: q, limit: qLimit ? Number(qLimit) : wordLimit(q) })
    setQuestion('')
    setQLimit('')
    setMode('')
    onOpen(`essay:${id}`)
  }
  const findStatements = () => {
    setMode('')
    runJob((strong) =>
      api.ask(app.id, 'Find every written statement or essay this application requires (statement of purpose, statement of interest, personal or research statement, or others), with the exact wording of each prompt and its word limit, and save them in essays. Keep existing ids.', strong),
    ).catch(() => undefined)
  }
  const link = 'text-xs text-muted hover:text-live'
  return (
    <div className="space-y-3 px-5 pt-4 pb-6">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <span className="text-xs text-muted/70">Add</span>
        <button className={link} onClick={() => setMode(mode === 'question' ? '' : 'question')}>
          Question
        </button>
        <button className={link} onClick={() => setMode(mode === 'statement' ? '' : 'statement')}>
          Statement
        </button>
        <button className={link} onClick={() => onOpen('letters')}>
          Recommender
        </button>
        <button className={link} onClick={() => setMode(mode === 'todo' ? '' : 'todo')}>
          To-do
        </button>
      </div>
      {mode === 'statement' && (
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(ESSAY_TYPES) as EssayType[]).filter((t) => t !== 'supervisor').map((t) => (
            <Button key={t} size="sm" onClick={() => addStatement(t)}>
              {ESSAY_TYPES[t].short}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={findStatements} disabled={!meta?.ai_configured} title="Claude reads their pages for every statement, its prompt and word limit">
            Find what they ask for
          </Button>
        </div>
      )}
      {mode === 'question' && (
        <div className="space-y-2">
          <Textarea autoFocus rows={4} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Paste the question exactly as the portal asks it (a program-specific question, a short answer)" className="text-sm" />
          <div className="flex items-center gap-2">
            <Input value={qLimit} onChange={(e) => setQLimit(e.target.value.replace(/\D/g, ''))} placeholder="Word limit" className="h-8 w-28 text-sm" inputMode="numeric" />
            <Button size="sm" variant="primary" onClick={addQuestion} disabled={!question.trim()}>
              Add question
            </Button>
          </div>
        </div>
      )}
      {mode === 'todo' && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (todo.trim()) update(app.id, { checklist: [...app.checklist, { item: todo.trim(), done: false }] })
            setTodo('')
            setMode('')
          }}
        >
          <Input autoFocus value={todo} onChange={(e) => setTodo(e.target.value)} placeholder="What needs doing, then Enter" className="h-8 text-sm" />
        </form>
      )}
      {finding && (
        <p className="flex items-center gap-2 text-xs text-muted">
          <Spinner className="text-live" /> {finding.activity?.[finding.activity.length - 1]?.text ?? 'Reading their pages'}
        </p>
      )}
    </div>
  )
}

const canToggle = (t: Task) => !['letters', 'letter', 'contact', 'submit'].includes(t.kind)

function TaskRow({ task, on, onOpen, onToggle }: { task: Task; on: boolean; onOpen: () => void; onToggle?: () => void }) {
  return (
    <div className={cx('group relative flex items-center gap-3 px-5', on ? 'bg-panel-2 before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-live' : 'hover:bg-panel')}>
      {onToggle ? (
        <button onClick={onToggle} className={cx('grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full ring-1', task.done ? 'bg-text ring-text text-black' : 'ring-line-strong hover:ring-text')} aria-label={task.done ? `Mark ${task.title} not done` : `Mark ${task.title} done`}>
          {task.done && <Tick />}
        </button>
      ) : (
        <span className={cx('grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full ring-1', task.done ? 'bg-text text-black ring-text' : 'ring-line ring-dashed')} aria-hidden>
          {task.done && <Tick />}
        </span>
      )}
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 py-2.5 text-left">
        <span className={cx('min-w-0 flex-1 truncate text-[0.95rem]', task.done && 'text-muted line-through decoration-muted/60')}>{task.title}</span>
        <span className={cx('shrink-0 text-xs', task.done ? 'text-muted' : 'text-muted/80')}>{task.status}</span>
        <Chevron className={cx(on ? 'text-live' : 'text-muted/60 group-hover:text-muted')} />
      </button>
    </div>
  )
}

const Tick = () => (
  <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3.5 8.5l3 3 6-7" />
  </svg>
)

/** Mark a to-do done (or not) in whichever field already tracks it. */
function useSetDone(app: Application) {
  const { update } = useData()
  return (t: Task, value: boolean) => {
    const today = todayISO()
    switch (t.kind) {
      case 'essay':
      case 'resume': {
        const cur = new Set(app.tasks_done ?? [])
        if (value) cur.add(t.key)
        else cur.delete(t.key)
        return update(app.id, { tasks_done: [...cur] })
      }
      case 'doc': {
        const k = docKey(t.ref ?? '')
        const cur = (app.documents_ready ?? []).filter((x) => x !== k)
        return update(app.id, { documents_ready: value ? [...cur, k] : cur })
      }
      case 'score': {
        const sends = { ...(app.score_sends ?? {}) }
        if (value) sends[t.ref!] = today
        else delete sends[t.ref!]
        return update(app.id, { score_sends: sends })
      }
      case 'check':
        return update(app.id, { checklist: app.checklist.map((c, i) => (i === t.index ? { ...c, done: value } : c)) })
      case 'fee':
        if (t.index === undefined) return update(app.id, { expenses: [{ label: 'Application fee', amount: null, currency: 'USD', paid: value, date: value ? today : null }] })
        return update(app.id, { expenses: app.expenses.map((e, i) => (i === t.index ? { ...e, paid: value, date: value ? e.date ?? today : e.date } : e)) })
      case 'submit':
        return update(app.id, {
          stage: value ? 'submitted' : 'preparing',
          checklist: app.checklist.map((c) => (/submit/i.test(c.item) ? { ...c, done: value } : c)),
        })
      case 'letter':
        return update(app.id, { recommenders: app.recommenders.map((r) => (r.id === t.ref ? { ...r, status: value ? 'submitted' : 'requested', submitted_on: value ? today : null } : r)) })
    }
  }
}

// ---------------------------------------------------------------- right: the open to-do

function Detail({ app, task, tasks, onOpen }: { app: Application; task: Task; tasks: Task[]; onOpen: (key: string) => void }) {
  const { update } = useData()
  const [params, setParams] = useSearchParams()
  if (task.kind === 'essay') return <EssayPane app={app} task={task} />
  // A supervisor's first email (?write=email): the essay editor and coach, on a file of its own.
  const contact = task.kind === 'contact' ? (app.faculty ?? [])[task.index ?? -1] : undefined
  if (contact && params.get('write') === 'email') {
    const back = () =>
      setParams((p) => {
        const next = new URLSearchParams(p)
        next.delete('write')
        return next
      })
    return <EssayPane app={app} task={task} essay={supervisorEmail(contact.name)} onBack={back} />
  }
  if (task.kind === 'resume') return <ResumeStudio app={app} task={task} />
  if (task.kind === 'final') return <FinalFolderPane app={app} tasks={tasks} onOpen={onOpen} />
  return (
    <div className="mx-auto max-w-4xl px-5 py-8 lg:px-10 lg:py-12">
      <div className="text-xs text-muted/70">{task.group}</div>
      <h2 className="mt-1 font-display text-[2rem] leading-tight">{task.title}</h2>
      <div className="mt-6">
        {task.kind === 'letter' && <LetterCard app={app} task={task} />}
        {task.kind === 'letters' && <ChooseRecommenders app={app} />}
        {task.kind === 'contact' && <ContactCard key={task.index} app={app} index={task.index!} />}
        {task.kind === 'doc' && (task.write ? <WriteDocCard app={app} task={task} onOpen={onOpen} /> : <DocCard app={app} task={task} />)}
        {task.kind === 'check' && <SimpleCard app={app} task={task} doneLabel="Done" action="Mark done" onRemove={() => update(app.id, { checklist: app.checklist.filter((_, i) => i !== task.index) })} />}
        {task.kind === 'score' && <ScoreCard app={app} task={task} />}
        {task.kind === 'fee' && <FeeCard app={app} task={task} />}
        {task.kind === 'submit' && <SubmitCard app={app} task={task} tasks={tasks} onOpen={onOpen} />}
      </div>
    </div>
  )
}

const FolderIcon = () => (
  <svg viewBox="0 0 16 16" className="h-[18px] w-[18px] shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round" aria-hidden>
    <path d="M1.75 4.25c0-.55.45-1 1-1h3.4l1.5 1.5h5.6c.55 0 1 .45 1 1v6.5c0 .55-.45 1-1 1H2.75c-.55 0-1-.45-1-1z" />
  </svg>
)

const kb = (size: number) => (size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`)

/** <application>/Final/: the final version of every file you upload. The app fills it from what's marked final
 *  (statements as PDFs, the resume, transcript, score reports); files you add yourself stay. See final.py. */
function FinalFolderPane({ app, tasks, onOpen }: { app: Application; tasks: Task[]; onOpen: (key: string) => void }) {
  const [data, setData] = useState<FinalFolder | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e))
  // Re-read when something that feeds the folder changes (a statement or the resume marked final).
  const marks = (app.tasks_done ?? []).join('|')
  useEffect(() => {
    api.finalFolder(app.id).then(setData, fail)
  }, [app.id, marks, app.resume?.built_at])
  const fill = async () => {
    setBusy(true)
    setError('')
    try {
      setData(await api.buildFinal(app.id))
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }
  const empty = !!data && data.files.length === 0
  return (
    <div className="mx-auto max-w-4xl px-5 py-8 lg:px-10 lg:py-12">
      <div className="text-xs text-muted/70">Finish</div>
      <h2 className="mt-1 font-display text-[2rem] leading-tight">Final folder</h2>
      <p className="mt-2 max-w-[70ch] text-sm leading-relaxed text-muted">
        Everything you upload to this application, final versions only. Statements and the resume come in once you mark them final; your transcript and score reports come from
        your files. Anything you put in the folder yourself stays.
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button variant={data?.stale || empty ? 'primary' : 'subtle'} loading={busy} onClick={fill}>
          {empty ? 'Fill folder' : 'Update folder'}
        </Button>
        <Button variant="ghost" onClick={() => api.openFinal(app.id).catch(fail)}>
          Open on this computer
        </Button>
        {data?.stale && !empty && !busy && <span className="text-sm text-accent">Something changed since the last update.</span>}
      </div>
      {data && (
        <p className="mt-2 truncate text-xs text-muted" title={data.folder}>
          {data.folder}
        </p>
      )}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      {data?.notes.map((n) => (
        <p key={n} className="mt-3 text-sm text-muted">
          {n}
        </p>
      ))}
      {!data && !error && (
        <div className="mt-8">
          <Spinner />
        </div>
      )}

      {data && (
        <>
          <h3 className="mt-10 mb-2 text-sm text-muted">
            In the folder <span className="num">{data.files.length}</span>
          </h3>
          {data.files.length ? (
            <ul className="divide-y divide-line border-y border-line">
              {data.files.map((f) => (
                <li key={f.name}>
                  <a href={api.finalFileUrl(app.id, f.name, f.modified)} target="_blank" rel="noreferrer" className="group flex items-center gap-4 py-2.5 text-sm hover:text-live">
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <span className="shrink-0 text-xs text-muted">{f.yours ? 'Added by you' : f.label}</span>
                    <span className="num w-16 shrink-0 text-right text-xs text-muted">{kb(f.size)}</span>
                    <Chevron className="text-muted/60 group-hover:text-live" />
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Empty. Fill folder copies in everything that's ready.</p>
          )}

          {data.missing.length > 0 && (
            <>
              <h3 className="mt-10 mb-2 text-sm text-muted">Not final yet</h3>
              <ul className="divide-y divide-line border-y border-line">
                {data.missing.map((m) => {
                  const canOpen = !!m.key && tasks.some((t) => t.key === m.key)
                  return (
                    <li key={`${m.key}:${m.label}`}>
                      <button
                        onClick={canOpen ? () => onOpen(m.key!) : undefined}
                        disabled={!canOpen}
                        className="group flex w-full items-center gap-4 py-2.5 text-left text-sm enabled:hover:text-live"
                      >
                        <span className="min-w-0 flex-1 truncate">{m.label}</span>
                        <span className="shrink-0 text-xs text-muted">{m.why}</span>
                        {canOpen && <Chevron className="text-muted/60 group-hover:text-live" />}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  )
}

/** Label on the left, one short line on the right. */
function Facts({ rows }: { rows: [string, ReactNode][] }) {
  const shown = rows.filter(([, v]) => v !== undefined && v !== null && v !== '')
  return (
    <dl className="divide-y divide-line border-y border-line">
      {shown.map(([k, v]) => (
        <div key={k} className="flex gap-4 py-2.5 text-sm">
          <dt className="w-28 shrink-0 text-muted">{k}</dt>
          <dd className="min-w-0 flex-1">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

const Line = ({ text }: { text?: string }) => (text ? <span className="line-clamp-2" title={text}>{text}</span> : null)

function DoneState({ label, when, onUndo }: { label: string; when?: string | null; onUndo: () => void }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="grid h-5 w-5 place-items-center rounded-full bg-text text-black">
        <Tick />
      </span>
      <span>
        {label}
        {when && <span className="text-muted"> {formatDate(when)}</span>}
      </span>
      <button onClick={onUndo} className="ml-2 text-xs text-muted hover:text-text">
        Undo
      </button>
    </div>
  )
}

function SimpleCard({ app, task, note, action, doneLabel, onRemove }: { app: Application; task: Task; note?: string; action: string; doneLabel: string; onRemove?: () => void }) {
  const setDone = useSetDone(app)
  return (
    <div className="space-y-6">
      {note && <p className="text-sm text-muted">{note}</p>}
      {task.done ? <DoneState label={doneLabel} onUndo={() => setDone(task, false)} /> : <Button variant="primary" onClick={() => setDone(task, true)}>{action}</Button>}
      {onRemove && (
        <button onClick={onRemove} className="block text-xs text-muted hover:text-danger">
          Remove this to-do
        </button>
      )}
    </div>
  )
}

const REC_STEPS: { id: RecStatus; label: string }[] = [
  { id: 'planned', label: 'Not asked' },
  { id: 'requested', label: 'Asked' },
  { id: 'reminded', label: 'Reminded' },
  { id: 'submitted', label: 'Received' },
]

function LetterCard({ app, task }: { app: Application; task: Task }) {
  const { recommenders, update } = useData()
  const r = app.recommenders.find((x) => x.id === task.ref)
  const p = recommenders.find((x) => x.id === task.ref)
  if (!r) return null
  const set = (status: RecStatus) => {
    const today = todayISO()
    update(app.id, {
      recommenders: app.recommenders.map((x) =>
        x.id === r.id ? { ...x, status, requested_on: status === 'planned' ? null : x.requested_on ?? today, submitted_on: status === 'submitted' ? x.submitted_on ?? today : null } : x,
      ),
    })
  }
  const next = REC_STEPS[REC_STEPS.findIndex((s) => s.id === r.status) + 1]
  return (
    <div className="space-y-8">
      <Facts
        rows={[
          ['Who', p?.role],
          ['Email', p?.email && <a href={`mailto:${p.email}?subject=${encodeURIComponent(`Recommendation letter: ${fullName(app)}`)}`} className="text-live hover:underline">{p.email}</a>],
          ['Asked', r.requested_on && formatDate(r.requested_on)],
          ['Received', r.submitted_on && formatDate(r.submitted_on)],
          ['Note', r.notes],
        ]}
      />
      <ol className="flex gap-1" aria-label="Letter status">
        {REC_STEPS.map((s) => (
          <li key={s.id} className="flex-1">
            <button onClick={() => set(s.id)} className={cx('w-full rounded-md py-2 text-xs', s.id === r.status ? 'bg-panel-2 text-text ring-1 ring-line-strong' : 'text-muted hover:bg-panel hover:text-text')}>
              {s.label}
            </button>
          </li>
        ))}
      </ol>
      {next && (
        <Button variant="primary" onClick={() => set(next.id)}>
          Mark {next.label.toLowerCase()}
        </Button>
      )}
      <button onClick={() => update(app.id, { recommenders: app.recommenders.filter((x) => x.id !== r.id) })} className="block text-xs text-muted hover:text-danger">
        Remove from this application
      </button>
    </div>
  )
}

function ChooseRecommenders({ app }: { app: Application }) {
  const { recommenders, update } = useData()
  const want = firstSentence(app.admission?.letters)
  const free = recommenders.filter((p) => !app.recommenders.some((r) => r.id === p.id))
  return (
    <div className="space-y-6">
      {want && <p className="text-sm text-muted">{want}</p>}
      {free.length === 0 ? (
        <p className="text-sm text-muted">{recommenders.length ? 'Everyone you have is already on this application.' : 'No recommenders saved yet. Add a folder per person under Common/Recommenders.'}</p>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {free.map((p) => (
            <li key={p.id} className="flex items-center gap-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-sm">{p.name}</div>
                <div className="truncate text-xs text-muted">{p.role}</div>
              </div>
              <Button size="sm" onClick={() => update(app.id, { recommenders: [...app.recommenders, { id: p.id, status: 'planned' }] })}>
                Add
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** What goes in the resume and in what order: ticked entries per section (in order), and the order of sections. */
type Layout = { sel: Record<string, string[]>; order: string[] }

const moved = <T,>(list: T[], from: number, to: number) => {
  const next = [...list]
  const [x] = next.splice(from, 1)
  next.splice(to, 0, x)
  return next
}

/**
 * The resume, built live from the entries you tick, in the order you drag them. Each change re-assembles the
 * master's own LaTeX (no text is edited, no AI) and recompiles; the PDF on the right reloads when it's done.
 */
function ResumeStudio({ app, task }: { app: Application; task: Task }) {
  const { replaceApp, runJob, runningJob, meta, toast } = useData()
  const setDone = useSetDone(app)
  const r = app.resume
  const [master, setMaster] = useState<ResumeSection[] | null>(null)
  const [layout, setLayout] = useState<Layout | null>(null)
  const latest = useRef<Layout | null>(null)
  latest.current = layout
  const [building, setBuilding] = useState(false)
  const busy = useRef(false)
  const [error, setError] = useState('')
  const pending = useRef<Layout | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const drag = useRef<{ section: string; entry?: string } | null>(null)
  const [dragging, setDragging] = useState('')
  const [focus, setFocus] = useState<string | null>(null)
  const aiBusy = runningJob('resume', app.id)
  const edited = app.resume_edits ?? {}

  // What's in, in order: the last build's plan, else (older builds) entries matched by title, else the whole master.
  const fromBuild = useCallback(
    (m: ResumeSection[]): Layout => {
      const all = m.map((s) => s.id)
      if (r?.plan) {
        const order = [...r.plan.map((s) => s.id), ...all.filter((id) => !r.plan!.some((s) => s.id === id))]
        return { sel: Object.fromEntries(r.plan.map((s) => [s.id, s.entries])), order }
      }
      if (r) {
        const titles = new Map(r.sections.map((s) => [s.id, s.entries]))
        const sel = Object.fromEntries(
          m.filter((s) => titles.has(s.id)).map((s) => {
            const want = titles.get(s.id)!
            const ids = s.entries.filter((e) => want.includes(e.title)).sort((a, b) => want.indexOf(a.title) - want.indexOf(b.title)).map((e) => e.id)
            return [s.id, ids]
          }),
        )
        return { sel, order: [...r.sections.map((s) => s.id).filter((id) => all.includes(id)), ...all.filter((id) => !titles.has(id))] }
      }
      return { sel: Object.fromEntries(m.map((s) => [s.id, s.entries.map((e) => e.id)])), order: all }
    },
    [r],
  )
  useEffect(() => {
    api
      .resumeMaster()
      .then((m) => {
        setMaster(m)
        setLayout(fromBuild(m))
      })
      .catch((e) => setError((e as Error).message))
    // Only on open; later builds update the layout themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.id])
  // A Claude build that just finished replaces the ticks and order with its choice.
  const lastBuilt = useRef(r?.built_at)
  useEffect(() => {
    if (master && r?.built_at !== lastBuilt.current && !building) setLayout(fromBuild(master))
    lastBuilt.current = r?.built_at
  }, [r?.built_at, master, building, fromBuild])

  const run = async (l: Layout) => {
    if (!master) return
    busy.current = true
    setBuilding(true)
    setError('')
    try {
      const blocks = new Set(master.filter((m) => m.entries.length === 0).map((m) => m.id))
      const sections = l.order.filter((id) => id in l.sel && (blocks.has(id) || l.sel[id].length > 0)).map((id) => ({ id, entries: l.sel[id] }))
      const saved = await api.resumePick(app.id, sections)
      lastBuilt.current = saved.resume?.built_at
      replaceApp(saved)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      busy.current = false
      setBuilding(false)
      const next = pending.current
      pending.current = null
      if (next) run(next)
    }
  }
  const schedule = (l: Layout) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => (busy.current ? (pending.current = l) : run(l)), 700)
  }
  const change = (l: Layout) => {
    setLayout(l)
    schedule(l)
  }

  const toggleSection = (s: ResumeSection) => {
    if (!layout) return
    const sel = { ...layout.sel }
    const cur = sel[s.id] ?? []
    if (s.id in sel && (s.entries.length === 0 || cur.length === s.entries.length)) delete sel[s.id]
    else sel[s.id] = [...cur, ...s.entries.map((e) => e.id).filter((id) => !cur.includes(id))]
    change({ ...layout, sel })
  }
  const toggleEntry = (s: ResumeSection, id: string) => {
    if (!layout) return
    const cur = layout.sel[s.id] ?? []
    const list = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] // newly ticked go to the end; drag to place
    const sel = { ...layout.sel, [s.id]: list }
    if (!list.length && s.entries.length) delete sel[s.id]
    change({ ...layout, sel })
  }
  // Moving rebuilds once you let go (or right away from the keyboard).
  const moveEntry = (section: string, id: string, to: number, build: boolean) => {
    const l = latest.current
    if (!l) return
    const list = l.sel[section] ?? []
    const from = list.indexOf(id)
    if (from < 0 || to < 0 || to >= list.length || from === to) return
    const next = { ...l, sel: { ...l.sel, [section]: moved(list, from, to) } }
    setLayout(next)
    if (build) schedule(next)
  }
  const moveSection = (id: string, to: number, build: boolean) => {
    const l = latest.current
    if (!l) return
    const from = l.order.indexOf(id)
    if (from < 0 || to < 0 || to >= l.order.length || from === to) return
    const next = { ...l, order: moved(l.order, from, to) }
    setLayout(next)
    if (build) schedule(next)
  }
  const endDrag = () => {
    if (drag.current && latest.current) schedule(latest.current)
    drag.current = null
    setDragging('')
  }
  const claude = () => runJob((strong) => api.buildResume(app.id, strong)).catch(() => toast('Claude could not build it', 'error'))

  const count = layout ? Object.values(layout.sel).reduce((n, l) => n + l.length, 0) : 0
  const byId = new Map((master ?? []).map((s) => [s.id, s]))
  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <div className="flex min-h-0 w-full shrink-0 flex-col border-line lg:w-[24rem] lg:border-r 3xl:w-[28rem]">
        <div className="border-b border-line px-5 py-3">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-lg leading-none">Resume</span>
            {r && <span className={cx('num text-sm', r.fits ? 'text-muted' : 'text-danger')}>{r.pages} of {r.max_pages} pages</span>}
            <span className="ml-auto flex items-center gap-1.5 text-xs text-muted">
              {building || aiBusy ? (
                <>
                  <Spinner className="text-live" /> {aiBusy ? 'Claude is picking' : 'Rebuilding'}
                </>
              ) : r ? (
                `Built ${formatDate(r.built_on)}`
              ) : (
                'Not built yet'
              )}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted">Tick what goes in, drag to reorder (or Alt and the arrow keys). It rebuilds as you go; the words are never changed.</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {!master || !layout ? (
            error ? <p className="px-2 text-sm text-danger">{error}</p> : <Spinner className="m-2 text-muted" />
          ) : (
            layout.order.map((sid, si) => {
              const s = byId.get(sid)
              if (!s) return null
              const on = layout.sel[s.id] ?? []
              const all = s.id in layout.sel && (s.entries.length === 0 || on.length === s.entries.length)
              const some = !all && on.length > 0
              const off = s.entries.filter((e) => !on.includes(e.id))
              const title = (id: string) => s.entries.find((e) => e.id === id)?.title ?? id
              return (
                <div
                  key={s.id}
                  className={cx('mb-2 rounded-md', dragging === s.id && 'opacity-40')}
                  onDragOver={(e) => {
                    const d = drag.current
                    if (!d || d.entry || d.section === s.id) return
                    e.preventDefault()
                    moveSection(d.section, si, false)
                  }}
                >
                  <Check
                    label={s.title}
                    on={all}
                    partial={some}
                    onClick={() => toggleSection(s)}
                    strong
                    edited={s.entries.length === 0 && s.id in edited}
                    onEdit={s.entries.length === 0 && all ? () => setFocus(s.id) : undefined}
                    focused={focus === s.id}
                    drag={{
                      onStart: () => {
                        drag.current = { section: s.id }
                        setDragging(s.id)
                      },
                      onEnd: endDrag,
                      onMove: (d) => moveSection(s.id, si + d, true),
                    }}
                  />
                  {on.map((id, ei) => (
                    <div
                      key={id}
                      className={cx(dragging === id && 'opacity-40')}
                      onDragOver={(e) => {
                        const d = drag.current
                        if (!d?.entry || d.section !== s.id || d.entry === id) return
                        e.preventDefault()
                        e.stopPropagation()
                        moveEntry(s.id, d.entry, ei, false)
                      }}
                    >
                      <Check
                        label={title(id)}
                        on
                        onClick={() => toggleEntry(s, id)}
                        indent
                        edited={id in edited}
                        onEdit={() => setFocus(id)}
                        focused={focus === id}
                        drag={{
                          onStart: () => {
                            drag.current = { section: s.id, entry: id }
                            setDragging(id)
                          },
                          onEnd: endDrag,
                          onMove: (d) => moveEntry(s.id, id, ei + d, true),
                        }}
                      />
                    </div>
                  ))}
                  {off.map((e) => (
                    <Check key={e.id} label={e.title} on={false} onClick={() => toggleEntry(s, e.id)} indent />
                  ))}
                </div>
              )
            })
          )}
        </div>
        {r?.plan && master && <ResumeEditor app={app} master={master} focus={focus} onFocus={setFocus} />}
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
          {!r && layout && (
            <Button size="sm" variant="primary" onClick={() => run(layout)} loading={building} disabled={!count}>
              Build it
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={claude} loading={!!aiBusy} disabled={!meta?.ai_configured || !!aiBusy || building} title="Claude picks and orders entries for this program to fit 3 pages">
            Let Claude pick
          </Button>
          <span className="ml-auto">
            {task.done ? <DoneState label="Final" onUndo={() => setDone(task, false)} /> : r && <Button size="sm" onClick={() => setDone(task, true)}>Mark final</Button>}
          </span>
          {error && master && <p className="basis-full text-xs text-danger">{error}</p>}
        </div>
      </div>
      <div className="min-h-[70vh] min-w-0 flex-1 bg-panel lg:min-h-0">
        {r ? (
          <iframe key={r.built_at} title="Resume PDF" src={api.resumePdfUrl(app.id, r.built_at)} className={cx('h-full min-h-[70vh] w-full transition-opacity lg:min-h-0', building && 'opacity-40')} />
        ) : (
          <p className="p-10 text-sm text-muted">Build it to see the PDF here.</p>
        )}
      </div>
    </div>
  )
}

/** A tick row. With `drag`, it has a grip to drag it and moves with Alt+Up / Alt+Down. */
function Check({ label, on, partial, onClick, strong, indent, drag, edited, onEdit, focused }: {
  label: string
  on: boolean
  partial?: boolean
  onClick: () => void
  strong?: boolean
  indent?: boolean
  drag?: { onStart: () => void; onEnd: () => void; onMove: (delta: number) => void }
  /** Reworded for this program (the master is unchanged). */
  edited?: boolean
  /** Point the resume editor at this row. */
  onEdit?: () => void
  focused?: boolean
}) {
  return (
    <div
      draggable={!!drag}
      onDragStart={(e) => {
        if (!drag) return
        e.stopPropagation()
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', label) // Firefox won't start a drag without data
        drag.onStart()
      }}
      onDragEnd={drag?.onEnd}
      className={cx('group flex items-start rounded-md hover:bg-panel', indent && 'pl-6')}
    >
      <span className={cx('mt-2 w-3 shrink-0 select-none text-center text-[0.7rem] leading-none', drag ? 'cursor-grab text-muted/40 group-hover:text-muted' : 'text-transparent')} aria-hidden>
        ⋮
      </span>
      <button
        onClick={onClick}
        onKeyDown={(e) => {
          if (!drag || !e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
          e.preventDefault()
          drag.onMove(e.key === 'ArrowUp' ? -1 : 1)
        }}
        className="flex min-w-0 flex-1 items-start gap-2.5 px-1.5 py-1.5 text-left"
      >
        <span className={cx('mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-[4px] ring-1', on ? 'bg-text text-black ring-text' : partial ? 'ring-text' : 'ring-line-strong')}>
          {on ? <Tick /> : partial ? <span className="h-0.5 w-2 bg-text" /> : null}
        </span>
        <span className={cx('min-w-0 text-sm leading-snug', strong ? 'font-medium' : on ? 'text-text' : 'text-muted', focused && 'text-live')}>
          {label}
          {edited && <span className="ml-1.5 text-xs font-normal text-live">edited</span>}
        </span>
      </button>
      {onEdit && (
        <button onClick={onEdit} className={cx('shrink-0 px-2 py-1.5 text-xs', focused ? 'text-live' : 'text-transparent group-hover:text-muted hover:!text-live focus:text-muted')}>
          Edit
        </button>
      )}
    </div>
  )
}

/** LaTeX of one entry as readable lines, for comparing an edit with the master. */
function texLines(tex: string): string[] {
  const clean = (t: string) => t.replace(/\\(textbf|textit|emph|href\{[^}]*\}|small|underline)\{/g, '{').replace(/\\&/g, '&').replace(/\\%/g, '%').replace(/--/g, '\u2013').replace(/[{}]/g, '').replace(/\\[a-zA-Z]+\*?/g, '').replace(/\s+/g, ' ').trim()
  const head = /\\resume(?:Subheading|ProjectHeading)\s*((?:\{[^}]*\}\s*)+)/.exec(tex)
  const lines: string[] = head ? [clean(head[1].replace(/\}\s*\{/g, ' | '))] : []
  for (const m of tex.matchAll(/\\resumeItem(?:Label)?\{((?:[^{}]|\{[^{}]*\})*)\}/g)) lines.push(`\u2022 ${clean(m[1])}`)
  return lines.length ? lines : tex.split('\n').map(clean).filter(Boolean)
}

const EDIT_EXAMPLES = ['Shorten to two bullets', 'Expand with what my master resume says', 'Tighten the wording', 'Lead with the most relevant result for this program']

/**
 * Ask Claude to reword specific entries for this program only ("shorten my TA roles"). The master never changes; each
 * edit is checked against your original wording before it's kept, and every edited entry can be compared and reverted.
 */
function ResumeEditor({ app, master, focus, onFocus }: { app: Application; master: ResumeSection[]; focus: string | null; onFocus: (id: string | null) => void }) {
  const { runJob, runningJob, meta, replaceApp, toast } = useData()
  const [q, setQ] = useState('')
  const [compare, setCompare] = useState<string | null>(null)
  const busy = runningJob('resume-edit', app.id)
  const edits = app.resume_edits ?? {}
  const last = app.resume_edit_log?.[0]
  const titleOf = (id: string) => {
    for (const s of master) {
      if (s.id === id) return s.title
      const e = s.entries.find((x) => x.id === id)
      if (e) return e.title
    }
    return id
  }
  const masterTex = (id: string) => master.find((s) => s.id === id)?.tex || master.flatMap((s) => s.entries).find((e) => e.id === id)?.tex || ''
  const send = () => {
    const instruction = q.trim()
    if (!instruction || busy) return
    runJob((strong) => api.resumeEdit(app.id, instruction, focus, strong))
      .then((j) => j.status === 'done' && setQ(''))
      .catch(() => undefined)
  }
  const revert = async (ids?: string[]) => {
    try {
      replaceApp(await api.resumeRevert(app.id, ids))
      toast(ids ? `Back to the master wording for ${titleOf(ids[0])}` : 'All edits reverted')
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  const editedIds = Object.keys(edits)

  return (
    <div className="max-h-[45%] shrink-0 overflow-y-auto border-t border-line px-5 py-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs text-muted/70">Ask Claude to edit</span>
        {focus && (
          <span className="flex min-w-0 items-center gap-1 rounded-full bg-panel-2 px-2 py-0.5 text-xs ring-1 ring-line-strong">
            <span className="truncate">{titleOf(focus)}</span>
            <button onClick={() => onFocus(null)} className="text-muted hover:text-text" aria-label="Edit the whole resume instead">
              ×
            </button>
          </span>
        )}
        <OpusToggle className="ml-auto h-6" />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
        className="flex gap-2"
      >
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={focus ? 'e.g. shorten to two bullets' : 'e.g. shorten my TA roles to two bullets each'} className="h-8 flex-1 text-sm" disabled={!meta?.ai_configured} />
        <Button size="sm" type="submit" loading={!!busy} disabled={!meta?.ai_configured || !q.trim() || !!busy}>
          Edit
        </Button>
      </form>
      {!q && !busy && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {EDIT_EXAMPLES.map((x) => (
            <button key={x} type="button" onClick={() => setQ(x)} className="rounded-full px-2.5 py-0.5 text-xs text-muted ring-1 ring-line hover:text-text">
              {x}
            </button>
          ))}
        </div>
      )}
      {busy && (
        <p className="mt-2 flex items-center gap-2 text-xs text-muted">
          <Spinner className="text-live" /> {busy.activity?.[busy.activity.length - 1]?.text ?? 'Waiting for a free agent'}
        </p>
      )}
      {last && !busy && (
        <div className="mt-3 border-l-2 border-line-strong pl-3 text-xs">
          <div className="text-text">{last.instruction}</div>
          {last.changes.map((c) => (
            <div key={c} className="text-muted">
              {c}
            </div>
          ))}
          {last.note && <div className="mt-1 text-muted/80">{last.note}</div>}
        </div>
      )}
      {editedIds.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 flex items-center text-xs text-muted/70">
            Edited for this program
            <button onClick={() => revert()} className="ml-auto text-muted hover:text-danger">
              Revert all
            </button>
          </div>
          {editedIds.map((id) => (
            <div key={id} className="py-1 text-xs">
              <div className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate">{titleOf(id)}</span>
                <button onClick={() => setCompare(compare === id ? null : id)} className="text-live hover:underline">
                  {compare === id ? 'Hide' : 'Compare'}
                </button>
                <button onClick={() => revert([id])} className="text-muted hover:text-danger">
                  Revert
                </button>
              </div>
              {compare === id && (
                <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                  {[
                    ['Master', masterTex(id)],
                    ['This program', edits[id]],
                  ].map(([k, tex]) => (
                    <div key={k} className="rounded-md bg-panel p-2">
                      <div className="mb-1 text-muted/70">{k}</div>
                      {texLines(tex).map((l, i) => (
                        <p key={i} className={cx('leading-snug', i === 0 ? 'font-medium' : 'mt-1 text-text/85')}>
                          {l}
                        </p>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Your files under Common/, fetched once per page load. */
let filesOnce: Promise<DocFile[]> | null = null
function useFiles() {
  const [files, setFiles] = useState<DocFile[]>([])
  useEffect(() => {
    ;(filesOnce ??= api.documents()).then(setFiles).catch(() => undefined)
  }, [])
  return files
}

/** A PDF or image shown right in the to-do, so you see exactly what you'll upload. */
function Preview({ url, name }: { url: string; name: string }) {
  if (/\.(png|jpe?g|webp|gif)$/i.test(name)) return <img src={url} alt={name} className="max-h-[75vh] rounded-md border border-line" />
  if (!/\.pdf$/i.test(name)) return null
  return <iframe title={name} src={url} className="h-[75vh] w-full rounded-md border border-line bg-panel" />
}

/** The file that best fits a required document: "unofficial transcripts…" -> Transcript/Transcript.pdf. */
function guessFile(doc: string, files: DocFile[]): DocFile | undefined {
  const d = doc.toLowerCase()
  const rules: [RegExp, RegExp][] = [
    [/transcript|mark ?sheet|grade/, /transcript|marksheet|grades/i],
    [/degree|certificate|diploma/, /degree|certificate|diploma/i],
    [/passport/, /passport/i],
    [/english|toefl|ielts|test score/, /test-scores/i],
  ]
  for (const [want, file] of rules) if (want.test(d)) return files.find((f) => file.test(f.path))
  return undefined
}

/** A required document you write (program-specific questions, research interests): start it in the editor. */
function WriteDocCard({ app, task, onOpen }: { app: Application; task: Task; onOpen: (key: string) => void }) {
  const addEssay = useAddEssay(app)
  const setDone = useSetDone(app)
  const [, setParams] = useSearchParams()
  // "Names of 3 potential supervisors": that's the Supervisors tab, not an essay.
  const aboutSupervisors = app.kind === 'program' && /supervisor/i.test(task.ref ?? task.title)
  const start = async () => {
    const doc = task.ref ?? task.title
    onOpen(`essay:${await addEssay('other', { title: docName(doc).slice(0, 60), prompt: doc, limit: wordLimit(doc), from: docKey(doc) })}`)
  }
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">{task.ref}</p>
      <p className="text-sm">This is something you write. Start it in the editor; if they ask several questions, add each one with Add, Question.</p>
      {aboutSupervisors && (
        <p className="text-sm">
          Pick and rank them on the Supervisors tab; tick the ones going on your application and copy their names from there.{' '}
          {(app.faculty ?? []).some((c) => c.final) && <span className="text-muted">On your application now: {(app.faculty ?? []).filter((c) => c.final).map((c) => c.name).join(', ')}.</span>}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {aboutSupervisors && (
          <Button variant="primary" onClick={() => setParams({ app: app.id, page: 'program', tab: 'supervisors' })}>
            Finalise supervisors
          </Button>
        )}
        <Button variant={aboutSupervisors ? 'subtle' : 'primary'} onClick={start}>
          Write it here
        </Button>
        {task.done ? <DoneState label="Done" onUndo={() => setDone(task, false)} /> : (
          <button onClick={() => setDone(task, true)} className="text-xs text-muted hover:text-text">
            Done elsewhere
          </button>
        )}
      </div>
    </div>
  )
}

function DocCard({ app, task }: { app: Application; task: Task }) {
  const { update } = useData()
  const setDone = useSetDone(app)
  const files = useFiles()
  const key = docKey(task.ref ?? task.title)
  const chosen = app.documents_files?.[key]
  const file = chosen === '' ? undefined : files.find((f) => f.path === chosen) ?? (chosen === undefined ? guessFile(task.ref ?? task.title, files) : undefined)
  const pick = (path: string) => update(app.id, { documents_files: { ...(app.documents_files ?? {}), [key]: path } })
  return (
    <div className="space-y-6">
      {task.ref && task.ref !== task.title && <p className="text-sm text-muted">{task.ref}</p>}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-muted">Your file</span>
        <select value={file?.path ?? ''} onChange={(e) => pick(e.target.value)} className="h-8 max-w-full rounded-md border border-line-strong bg-bg px-2 text-sm">
          <option value="">None yet</option>
          {files.map((f) => (
            <option key={f.path} value={f.path}>
              {f.path}
            </option>
          ))}
        </select>
        {file && <ExternalLink href={api.fileUrl(file.path)}>Open</ExternalLink>}
      </div>
      {task.done ? <DoneState label="Ready" onUndo={() => setDone(task, false)} /> : <Button variant="primary" onClick={() => setDone(task, true)}>Mark ready</Button>}
      {file ? <Preview url={api.fileUrl(file.path)} name={file.name} /> : <p className="text-sm text-muted">Put the file under Common/ (for example Common/Transcript/) and pick it here.</p>}
    </div>
  )
}

function ScoreCard({ app, task }: { app: Application; task: Task }) {
  const { profile } = useData()
  const setDone = useSetDone(app)
  const t = profile?.tests?.find((x) => x.name === task.ref)
  const sent = app.score_sends?.[task.ref ?? '']
  const booked = t && t.total == null
  return (
    <div className="space-y-8">
      <Facts
        rows={[
          ['Your score', t && (booked ? `Booked for ${formatDate(t.date)}` : `${t.total}${t.max ? ` / ${t.max}` : ''}`)],
          ['Taken', t && !booked && formatDate(t.date)],
          ['Valid until', t?.expires && formatDate(t.expires)],
          ['They ask', <Line text={firstSentence(/gre/i.test(task.ref ?? '') ? app.admission?.gre : app.admission?.english)} />],
        ]}
      />
      {sent ? (
        <DoneState label="Sent" when={sent} onUndo={() => setDone(task, false)} />
      ) : booked ? (
        <p className="text-sm text-muted">
          Once your scores are out, add them in{' '}
          <Link to="/you/tests" className="text-live hover:underline">
            You, Tests
          </Link>
          , then send them and mark it here.
        </p>
      ) : (
        <Button variant="primary" onClick={() => setDone(task, true)}>
          Mark sent
        </Button>
      )}
      {t?.file && <Preview url={api.fileUrl(t.file)} name={t.file} />}
    </div>
  )
}

function FeeCard({ app, task }: { app: Application; task: Task }) {
  const { update } = useData()
  const { toHome, home, charges } = useHomeMoney()
  const setDone = useSetDone(app)
  const e = task.index !== undefined ? app.expenses[task.index] : undefined
  const save = (patch: { amount?: number | null; currency?: string }) =>
    update(app.id, {
      expenses: e
        ? app.expenses.map((x, i) => (i === task.index ? { ...x, ...patch } : x))
        : [{ label: 'Application fee', amount: null, currency: 'USD', paid: false, date: null, ...patch }],
    })
  return (
    <div className="space-y-8">
      <Facts
        rows={[
          [
            'Amount',
            <span className="flex items-center gap-2">
              <EditableText type="number" value={e?.amount ?? ''} onSave={(v) => save({ amount: v.trim() ? Number(v) : null })} placeholder="Amount" className="h-8 w-28 py-1" />
              <EditableText value={e?.currency ?? 'USD'} onSave={(v) => save({ currency: v.trim().toUpperCase() || 'USD' })} className="h-8 w-20 py-1 uppercase" />
              {e?.amount != null && <span className="text-muted">{money(e.amount, e.currency)}</span>}
            </span>,
          ],
          ['On your card', e?.amount != null && (e.currency || 'USD').toUpperCase() !== home && toHome(e.amount, e.currency) != null && <span title={`Today's rate + ${charges.fx_fee_pct}% card fee + ${charges.tax_on_fee_pct}% tax on the fee`}>about {money(toHome(e.amount, e.currency), home)}</span>],
          ['Pay at', app.portal?.url && <ExternalLink href={app.portal.url}>{app.portal.url.replace(/^https?:\/\//, '').slice(0, 40)}</ExternalLink>],
        ]}
      />
      {task.done ? <DoneState label="Paid" when={e?.date} onUndo={() => setDone(task, false)} /> : <Button variant="primary" onClick={() => setDone(task, true)}>Mark paid</Button>}
    </div>
  )
}

function SubmitCard({ app, task, tasks, onOpen }: { app: Application; task: Task; tasks: Task[]; onOpen: (key: string) => void }) {
  const { update } = useData()
  const setDone = useSetDone(app)
  const left = tasks.filter((t) => !t.done && t.key !== 'submit')
  const d = mainDeadline(app)
  return (
    <div className="space-y-8">
      <Facts
        rows={[
          ['Deadline', d && <span>{formatDate(d.date)} <span className={urgencyClass(d.date)}>{countdown(d.date)}</span></span>],
          [
            'Portal',
            <span className="flex flex-wrap items-center gap-3">
              <EditableText value={app.portal?.url} onSave={(v) => update(app.id, { portal: { ...app.portal, url: v.trim() } })} placeholder="https://… the application portal" className="h-8 max-w-80 py-1" />
              {app.portal?.url && <ExternalLink href={app.portal.url}>Open</ExternalLink>}
            </span>,
          ],
          ['Signed up as', <EditableText value={app.portal?.username} onSave={(v) => update(app.id, { portal: { ...app.portal, username: v.trim() } })} placeholder="Username or email (never a password)" className="h-8 max-w-80 py-1" />],
        ]}
      />
      {!task.done && left.length > 0 && (
        <div>
          <div className="mb-1 text-xs text-muted/70">Still open</div>
          <ul className="divide-y divide-line border-y border-line">
            {left.map((t) => (
              <li key={t.key}>
                <button onClick={() => onOpen(t.key)} className="group flex w-full items-center gap-3 py-2.5 text-left text-sm">
                  <span className="flex-1 truncate group-hover:text-live">{t.title}</span>
                  <span className="text-xs text-muted">{t.status}</span>
                  <Chevron className="text-muted" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {task.done ? <DoneState label="Submitted" onUndo={() => setDone(task, false)} /> : <Button variant="primary" onClick={() => setDone(task, true)}>Mark submitted</Button>}
    </div>
  )
}

/** What you need to know about the program while applying, in single lines. The full research stays in Research mode. */
function ProgramInfo({ app, onFull }: { app: Application; onFull: () => void }) {
  const ad = app.admission ?? {}
  const dates = app.deadlines.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date ?? '') && daysUntil(d.date) >= 0).sort((x, y) => x.date.localeCompare(y.date))
  return (
    <div className="mx-auto max-w-2xl px-5 py-8 lg:px-10 lg:py-12">
      <div className="text-xs text-muted/70">Program info</div>
      <h2 className="mt-1 font-display text-[2rem] leading-tight">{fullName(app)}</h2>
      {app.kind === 'program' && <p className="mt-1 text-muted">{app.name}</p>}
      <div className="mt-8 space-y-8">
        {dates.length > 0 && (
          <Facts
            rows={dates.map((d): [string, ReactNode] => [
              formatDate(d.date),
              <span className="flex items-baseline justify-between gap-3">
                <span className={cx('truncate', d.done && 'text-muted line-through')} title={d.label}>
                  {shortLabel(d.label)}
                </span>
                {!d.done && <span className={cx('num shrink-0', urgencyClass(d.date))}>{countdown(d.date)}</span>}
              </span>,
            ])}
          />
        )}
        <Facts
          rows={[
            ['English', <Line text={firstSentence(ad.english)} />],
            ['GPA', <Line text={firstSentence(ad.gpa)} />],
            ['GRE', <Line text={firstSentence(ad.gre)} />],
            ['Letters', <Line text={firstSentence(ad.letters)} />],
            ['Tuition', <Line text={app.tuition_usd_per_year ? `${money(app.tuition_usd_per_year)} a year` : firstSentence(app.tuition)} />],
            ['Funding', <Line text={firstSentence(app.funding_details?.summary ?? app.funding)} />],
            ['Portal', app.portal?.url && <ExternalLink href={app.portal.url}>{app.portal.url.replace(/^https?:\/\//, '').slice(0, 40)}</ExternalLink>],
          ]}
        />
        <div className="flex flex-wrap gap-5 text-sm">
          {app.url && <ExternalLink href={app.url}>Official page</ExternalLink>}
          <button onClick={onFull} className="inline-flex items-center gap-0.5 text-live hover:underline">
            Full program page <Chevron />
          </button>
        </div>
      </div>
    </div>
  )
}

const CONTACT_STEPS = ['to contact', 'emailed', 'no reply', 'replied', 'meeting', 'not taking students'].map((id) => ({ id, label: CONTACT_STATUS[id] }))

/** A supervisor you're tracking: where things stand and your notes. Ranking and finalising them is on the Supervisors tab. */
function ContactCard({ app, index }: { app: Application; index: number }) {
  const { update } = useData()
  const [, setParams] = useSearchParams()
  const c = (app.faculty ?? [])[index]
  const p = (app.faculty_profiles ?? []).find((x) => x.name.toLowerCase() === c?.name.toLowerCase())
  const [notes, setNotes] = useState(c?.notes ?? '')
  if (!c) return null
  const save = (patch: Partial<typeof c>) => update(app.id, { faculty: (app.faculty ?? []).map((x, i) => (i === index ? { ...x, ...patch } : x)) })
  const set = (status: string) => save({ status, contacted_on: status === 'to contact' ? null : c.contacted_on ?? todayISO() })
  return (
    <div className="space-y-8">
      <Facts
        rows={[
          ['Works on', <Line text={firstSentence(p?.research ?? c.research)} />],
          ['Match', p?.match && p.match.charAt(0).toUpperCase() + p.match.slice(1)],
          ['Taking students', p?.accepting && p.accepting !== 'unknown' ? (p.accepting === 'yes' ? 'Yes' : 'No') : undefined],
          ['Email', c.email && <a href={`mailto:${c.email}`} className="text-live hover:underline">{c.email}</a>],
          ['Profile', p?.url && <ExternalLink href={p.url}>Official profile</ExternalLink>],
          ['Emailed', c.contacted_on && formatDate(c.contacted_on)],
        ]}
      />
      <ol className="grid grid-cols-3 gap-1 sm:grid-cols-6" aria-label="Contact status">
        {CONTACT_STEPS.map((s) => (
          <li key={s.id} className="flex-1">
            <button onClick={() => set(s.id)} className={cx('w-full rounded-md py-2 text-xs', s.id === c.status || CONTACT_STATUS[c.status] === s.label ? 'bg-panel-2 text-text ring-1 ring-line-strong' : 'text-muted hover:bg-panel hover:text-text')}>
              {s.label}
            </button>
          </li>
        ))}
      </ol>
      <div>
        <div className="mb-1 text-xs text-muted/70">Your notes</div>
        <Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== c.notes && save({ notes })} placeholder="What you wrote, what they said" />
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <Button
          variant={c.status === 'to contact' ? 'primary' : 'subtle'}
          onClick={() => setParams((prev) => { const next = new URLSearchParams(prev); next.set('write', 'email'); return next })}
          title="Write your first email in the essay editor; the coach gives pointers from their deep dive and your notes, and reviews your draft"
        >
          Write email
        </Button>
        {c.status === 'to contact' && (
          <Button onClick={() => set('emailed')}>
            Mark emailed
          </Button>
        )}
        <button onClick={() => setParams({ app: app.id, page: 'program', tab: 'supervisors' })} className="text-sm text-live hover:underline">
          All supervisors for this program
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- full program page (read-only)

type ProgramTab = 'about' | 'requirements' | 'supervisors' | 'faculty' | 'funding' | 'notes'

/** Everything known about the program, read-only: the same pages as Research mode without any research buttons. */
function ProgramPage({ app, onClose }: { app: Application; onClose: () => void }) {
  const { update, toast } = useData()
  const [params, setParams] = useSearchParams()
  const isProgram = app.kind === 'program'
  const tabs: { id: ProgramTab; label: string }[] = [
    { id: 'about', label: isProgram ? 'Program' : 'Scholarship' },
    ...(isProgram
      ? [
          { id: 'requirements' as ProgramTab, label: reqLabel(app) },
          { id: 'supervisors' as ProgramTab, label: `Supervisors${app.faculty?.length ? ` ${app.faculty.length}` : ''}` },
          { id: 'faculty' as ProgramTab, label: `Faculty${app.faculty_profiles?.length ? ` ${app.faculty_profiles.length}` : ''}` },
          { id: 'funding' as ProgramTab, label: 'Funding' },
        ]
      : []),
    { id: 'notes', label: 'Notes' },
  ]
  const tab = (tabs.find((t) => t.id === params.get('tab'))?.id ?? 'about') as ProgramTab
  const setTab = (t: ProgramTab) => setParams({ app: app.id, page: 'program', ...(t === 'about' ? {} : { tab: t }) })
  const backToShortlist = async () => {
    if (!confirm(`Move ${shortName(app)} back to Shortlisted? It leaves Apply and goes back to Research. Your drafts and to-dos are kept.`)) return
    await update(app.id, { stage: 'shortlisted' })
    toast(`${shortName(app)} is back on the shortlist`)
  }
  const researched = app.researched_on

  return (
    <main className="min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[110rem] px-5 pt-6 pb-16 lg:px-10 lg:pt-8">
        <button onClick={onClose} className="mb-4 hidden items-center gap-1 text-sm text-muted hover:text-text lg:inline-flex">
          <span aria-hidden>‹</span> To-dos
        </button>
        <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3">
          <div className="min-w-0">
            <h1 className="font-display text-[2rem] leading-[1.05] lg:text-[2.6rem]">{fullName(app)}</h1>
            {isProgram && <p className="mt-1.5 text-lg text-text/85">{app.name}</p>}
            <p className="mt-2 text-sm text-muted">
              {[app.city, app.country].filter(Boolean).join(', ')}
              {researched && <span>{[app.city, app.country].some(Boolean) ? '. ' : ''}Researched {formatDate(researched)}</span>}
            </p>
          </div>
          <div className="flex items-center gap-4 text-sm">
            {app.url && <ExternalLink href={app.url}>Official page</ExternalLink>}
            <button onClick={backToShortlist} className="text-muted hover:text-text">
              Back to shortlist
            </button>
          </div>
        </div>
        <div className="mt-6">
          <AskClaude app={app} apply />
        </div>
        {isProgram ? (
          <ReadOnly.Provider value={true}>
            <ProgramTabs
              app={app}
              tab={programTab(params.get('tab'))}
              onTab={(t) => setParams({ app: app.id, page: 'program', ...(t === 'details' ? {} : { tab: t }) })}
              supervisors={<Supervisors app={app} />}
            />
          </ReadOnly.Provider>
        ) : (<>
        <nav className="mb-8 flex gap-6 border-b border-line" aria-label="Program sections">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className={cx('-mb-px border-b-2 pb-2.5 text-sm', tab === t.id ? 'border-live text-text' : 'border-transparent text-muted hover:text-text')}>
              {t.label}
            </button>
          ))}
        </nav>
        <ReadOnly.Provider value={true}>
          {tab === 'about' && <ProgramProfile app={app} onShowFaculty={() => setTab('faculty')} />}
          {tab === 'requirements' && <RequirementsChecklist app={app} />}
          {tab === 'supervisors' && <Supervisors app={app} />}
          {tab === 'faculty' && <FacultyDirectory app={app} />}
          {tab === 'funding' && <FundingTab app={app} />}
          {tab === 'notes' && <div className="max-w-[80ch]"><Markdown>{app.body || '_No notes yet._'}</Markdown></div>}
        </ReadOnly.Provider>
        </>)}
      </div>
    </main>
  )
}

// ---------------------------------------------------------------- essay editor

/** Change a statement's name, its question and word limit (for pasting a PSQ exactly as the portal shows it). */
function EssayEditor({ essay, prompt, limit, onSave, onCancel }: { essay: Essay; prompt: string; limit: number | null; onSave: (p: Partial<Essay>) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(essay.title)
  const [q, setQ] = useState(prompt)
  const [l, setL] = useState(limit ? String(limit) : '')
  return (
    <div className="space-y-2 border-b border-line px-5 py-3 lg:px-8">
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Name" className="h-8 text-sm" />
      <Textarea rows={4} value={q} onChange={(e) => setQ(e.target.value)} placeholder="The question, exactly as they ask it" className="text-sm" />
      <div className="flex items-center gap-2">
        <Input value={l} onChange={(e) => setL(e.target.value.replace(/\D/g, ''))} placeholder="Word limit" className="h-8 w-28 text-sm" inputMode="numeric" />
        <Button size="sm" variant="primary" onClick={() => onSave({ title: title.trim() || essay.title, prompt: q.trim(), limit: l ? Number(l) : null })}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/** A quiet full-page editor. Saves as you type to SOP.md / SOI.md / Essay-<id>.md; the coach waits behind a button. */
function EssayPane({ app, task, essay: given, onBack }: { app: Application; task: Task; essay?: Essay; onBack?: () => void }) {
  const { replaceApp, runJob, runningJob, meta, update, toast } = useData()
  const setDone = useSetDone(app)
  const essay = given ?? essaysFor(app).find((e) => e.id === task.ref)!
  // Supervisor emails aren't statements: no "final", no PDF, nothing to upload; the prompt is fixed.
  const isEmail = essay.type === 'supervisor'
  const [text, setText] = useState('')
  const [coach, setCoach] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [status, setStatus] = useState<'saved' | 'saving' | 'dirty'>('saved')
  const [panel, setPanel] = useState<'coach' | 'comments' | 'history' | null>(null)
  const [promptOpen, setPromptOpen] = useState(false)
  const [comments, setComments] = useState<EssayComment[]>([])
  const [activeComment, setActiveComment] = useState<string | null>(null)
  const [pending, setPending] = useState<{ start: number; end: number; quote: string } | null>(null)
  const [viewing, setViewing] = useState<(EssayVersion & { text: string }) | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [versionsTick, setVersionsTick] = useState(0)
  const area = useRef<HTMLTextAreaElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    api.getEssay(app.id, essay.id).then((r) => {
      setText(r.text)
      setCoach(r.coach)
      setComments(relocateComments(r.text, r.comments ?? []))
      setLoaded(true)
    })
  }, [app.id, essay.id])

  // Comments are saved with the text, so their offsets always match the file.
  const persist = useCallback(
    async (value: string, cs: EssayComment[] = latest.current.comments) => {
      setStatus('saving')
      const r = await api.saveEssay(app.id, essay.id, value, cs)
      setStatus('saved')
      if (r.version) setVersionsTick((n) => n + 1)
      if (!isEmail && !(app.essays_started ?? []).includes(essay.id)) replaceApp({ ...app, has_sop: app.has_sop || essay.id === 'sop', essays_started: [...(app.essays_started ?? []), essay.id] })
    },
    [app, essay.id, isEmail, replaceApp],
  )
  // Don't lose the last keystrokes when switching to another to-do.
  const latest = useRef({ text, status, persist, comments })
  latest.current = { text, status, persist, comments }
  useEffect(() => () => {
    clearTimeout(timer.current)
    if (latest.current.status === 'dirty') latest.current.persist(latest.current.text)
  }, [])

  const saveSoon = (value: string, cs: EssayComment[]) => {
    setStatus('dirty')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => persist(value, cs), 800)
  }
  const change = (value: string) => {
    const cs = shiftComments(text, value, comments)
    setText(value)
    setComments(cs)
    saveSoon(value, cs)
  }
  const setNotes = (cs: EssayComment[]) => {
    setComments(cs)
    saveSoon(text, cs)
  }
  const startComment = (from: number, to: number) => {
    const [start, end] = snapToWords(text, from, to)
    if (end <= start) return
    setPending({ start, end, quote: text.slice(start, end) })
    setActiveComment(null)
    setPanel('comments')
  }
  const addComment = (note: string) => {
    if (!pending) return
    const c: EssayComment = { id: Math.random().toString(36).slice(2, 10), ...pending, text: note, created: new Date().toISOString(), resolved: false }
    setNotes([...comments, c])
    setPending(null)
    setActiveComment(c.id)
  }
  const jumpTo = (c: EssayComment) => {
    setActiveComment(c.id)
    setViewing(null)
    requestAnimationFrame(() => {
      const el = area.current
      if (!el) return
      el.focus()
      el.setSelectionRange(c.start, c.end)
    })
  }
  const activate = (id: string | null) => {
    setActiveComment(id)
    // Clicking a highlight shows its note, but never swaps out the coach or history you have open.
    if (id && !panel && window.matchMedia('(min-width: 768px)').matches) setPanel('comments')
  }

  const saveVersion = async (label: string) => {
    clearTimeout(timer.current)
    await persist(text)
    const r = await api.saveEssayVersion(app.id, essay.id, label, text)
    toast(r.version ? 'Version saved' : 'Nothing new since the last version')
    setVersionsTick((n) => n + 1)
  }
  const viewVersion = async (id: string) => {
    if (viewing?.id === id) return setViewing(null)
    setViewing(await api.essayVersion(app.id, essay.id, id))
  }
  const restore = async () => {
    if (!viewing) return
    setRestoring(true)
    try {
      clearTimeout(timer.current)
      await persist(text)
      const r = await api.restoreEssayVersion(app.id, essay.id, viewing.id)
      const cs = relocateComments(r.text, comments)
      setText(r.text)
      setComments(cs)
      await persist(r.text, cs)
      setViewing(null)
      setVersionsTick((n) => n + 1)
      toast(`Restored ${versionName(viewing).toLowerCase()}. Your previous draft is in History.`)
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setRestoring(false)
    }
  }
  const markFinal = async () => {
    clearTimeout(timer.current)
    await persist(text)
    await api.saveEssayVersion(app.id, essay.id, 'Marked final', text)
    setVersionsTick((n) => n + 1)
    setDone(task, true)
  }

  // Ctrl+B / Ctrl+I wrap the selection in Markdown, so the file stays plain text.
  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'm') {
      e.preventDefault()
      const { selectionStart: s, selectionEnd: t } = e.currentTarget
      if (t > s) startComment(s, t)
      return
    }
    const mark = (e.ctrlKey || e.metaKey) && ({ b: '**', i: '_' } as Record<string, string>)[e.key.toLowerCase()]
    if (!mark) return
    e.preventDefault()
    const el = e.currentTarget
    const { selectionStart: s, selectionEnd: t } = el
    change(text.slice(0, s) + mark + text.slice(s, t) + mark + text.slice(t))
    requestAnimationFrame(() => el.setSelectionRange(s + mark.length, t + mark.length))
  }

  const coachJob = (kind: string) => {
    const j = runningJob(kind, app.id)
    return j && (j.params?.essay ?? 'sop') === essay.id ? j : undefined
  }
  const busy = coachJob('sop-outline') ? 'outline' : coachJob('sop-review') ? 'review' : null
  const wasBusy = useRef(busy)
  useEffect(() => {
    if (wasBusy.current && !busy) api.getEssay(app.id, essay.id).then((r) => setCoach(r.coach))
    wasBusy.current = busy
  }, [busy, app.id, essay.id])
  const ask = async (kind: 'outline' | 'review') => {
    if (kind === 'review') {
      clearTimeout(timer.current)
      await persist(text)
    }
    runJob((strong) => (kind === 'outline' ? api.essayOutline(app.id, essay.id, strong) : api.essayReview(app.id, essay.id, text, strong))).catch(() => undefined)
  }

  const [editing, setEditing] = useState(false)
  const saveEssay = (patch: Partial<Essay>) => update(app.id, { essays: essaysFor(app).map((e) => (e.id === essay.id ? { ...e, ...patch } : e)) })
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      toast(`Copied ${words} words`)
    } catch {
      toast('Could not copy to the clipboard', 'error')
    }
  }
  const [makingPdf, setMakingPdf] = useState(false)
  const [pdfAt, setPdfAt] = useState('')
  const makePdf = async () => {
    setMakingPdf(true)
    try {
      clearTimeout(timer.current)
      await persist(text)
      const r = await api.essayPdf(app.id, essay.id)
      setPdfAt(r.made_at)
      window.open(api.essayPdfUrl(app.id, essay.id, r.made_at), '_blank', 'noreferrer')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setMakingPdf(false)
    }
  }
  const finding = runningJob('ask', app.id)
  const findPrompt = () =>
    runJob((strong) => api.ask(app.id, `Find the exact wording of the ${essay.title.toLowerCase()} prompt and its word limit, and save them on that statement in essays. Leave the other statements as they are.`, strong)).catch(() => undefined)
  const all = essaysFor(app)
  const remove = () => {
    if (!confirm(`Remove “${essay.title}” from ${shortName(app)}? Its draft file stays in the folder.`)) return
    update(app.id, { essays: all.filter((e) => e.id !== essay.id) })
  }

  const words = text.trim() ? text.trim().split(/\s+/).length : 0
  const openComments = comments.filter((c) => !c.resolved).length
  const prompt = essay.prompt || (essay.id === 'sop' ? app.sop_prompt ?? '' : '')
  const limit = essay.limit ?? wordLimit(prompt)

  return (
    <div className="flex h-full min-h-0">
      <div className={cx('flex min-w-0 flex-1 flex-col', panel && 'hidden md:flex')}>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line px-5 py-3 text-sm lg:px-8">
          {onBack && (
            <button onClick={onBack} className="inline-flex items-center gap-1 text-muted hover:text-text">
              <span aria-hidden>‹</span> {essay.person ?? 'Back'}
            </button>
          )}
          <span className="font-display text-lg leading-none">{isEmail ? essay.title : task.title}</span>
          <span className={cx('num', limit && words > limit ? 'text-danger' : 'text-muted')}>
            {words}
            {limit ? ` / ${limit}` : ''} words
          </span>
          <span className="text-xs text-muted/70">{status === 'saving' ? 'Saving' : status === 'dirty' ? 'Editing' : 'Saved'}</span>
          <div className="ml-auto flex items-center gap-2">
            {isEmail ? null : task.done ? (
              <button onClick={() => setDone(task, false)} className="text-xs text-muted hover:text-text">
                Final. Undo
              </button>
            ) : (
              <Button size="sm" variant="ghost" onClick={markFinal} disabled={!text.trim()} title="Also keeps this text as a version">
                Mark final
              </Button>
            )}
            {pdfAt && !isEmail && (
              <a href={api.essayPdfUrl(app.id, essay.id, pdfAt)} target="_blank" rel="noreferrer" className="text-xs text-live hover:underline">
                Open PDF
              </a>
            )}
            <Button size="sm" variant="ghost" onClick={copy} disabled={!text.trim()} title={isEmail ? 'Copy the email to paste into your mail app' : 'Copy the answer to paste into the portal'}>
              Copy text
            </Button>
            {!isEmail && (
              <Button size="sm" variant="ghost" onClick={makePdf} loading={makingPdf} disabled={!text.trim()} title="Typesets your draft, exactly as written, to a PDF beside it">
                {pdfAt ? 'Remake PDF' : 'Make PDF'}
              </Button>
            )}
            {(['comments', 'history', 'coach'] as const).map((p) => (
              <Button key={p} size="sm" onClick={() => setPanel((v) => (v === p ? null : p))} className={cx(panel === p && 'text-live ring-live/50')}>
                {p === 'comments' ? `Comments${openComments ? ` ${openComments}` : ''}` : p === 'history' ? 'History' : 'Coach'}
              </Button>
            ))}
          </div>
        </div>
        {editing && (
          <EssayEditor essay={essay} prompt={prompt} limit={limit} onSave={(p) => { saveEssay(p); setEditing(false) }} onCancel={() => setEditing(false)} />
        )}
        {!editing && !prompt && (
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-2.5 text-sm text-muted lg:px-8">
            {finding ? (
              <>
                <Spinner className="text-live" /> {finding.activity?.[finding.activity.length - 1]?.text ?? 'Reading their pages'}
              </>
            ) : (
              <>
                No prompt saved yet.
                <button onClick={() => setEditing(true)} className="text-live hover:underline">
                  Paste it
                </button>
                <button onClick={findPrompt} disabled={!meta?.ai_configured} className="text-live hover:underline disabled:text-muted">
                  Find the prompt
                </button>
              </>
            )}
            {all.length > 1 && (
              <button onClick={remove} className="ml-auto text-xs hover:text-danger">
                Remove statement
              </button>
            )}
          </div>
        )}
        {!editing && prompt && (
          <div className="flex items-start gap-3 border-b border-line px-5 lg:px-8">
          <button onClick={() => setPromptOpen((v) => !v)} className="min-w-0 flex-1 py-2.5 text-left text-sm text-muted hover:text-text" title={promptOpen ? 'Show less' : 'Show the whole prompt'}>
            <span className={cx(!promptOpen && 'line-clamp-1')}>{prompt}</span>
          </button>
            {!isEmail && (
              <button onClick={() => setEditing(true)} className="shrink-0 py-2.5 text-xs text-muted hover:text-live">
                Edit
              </button>
            )}
          </div>
        )}
        {viewing ? (
          <VersionView version={viewing} current={text} onRestore={restore} onClose={() => setViewing(null)} restoring={restoring} />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loaded ? (
              <CommentedTextarea
                value={text}
                onChange={change}
                onKeyDown={keys}
                comments={comments}
                active={activeComment}
                onActive={activate}
                onComment={startComment}
                areaRef={area}
                placeholder="Start writing. The coach can give you a structure first."
              />
            ) : (
              <div className="p-8">
                <Spinner className="text-muted" />
              </div>
            )}
          </div>
        )}
      </div>

      {panel && (
        <aside className="flex w-full min-w-0 flex-col border-line md:w-[24rem] md:border-l 3xl:w-[30rem]">
          <div className="flex items-center gap-2 border-b border-line px-5 py-3">
            <span className="font-display text-lg leading-none">{panel === 'comments' ? 'Comments' : panel === 'history' ? 'History' : 'Coach'}</span>
            {panel === 'coach' && <OpusToggle className="ml-auto" />}
            <button onClick={() => setPanel(null)} className={cx('px-1 text-sm text-muted hover:text-text md:hidden', panel !== 'coach' && 'ml-auto')}>
              Back to draft
            </button>
          </div>
          {panel === 'comments' && (
            <CommentsPanel
              comments={comments}
              pending={pending}
              active={activeComment}
              onAdd={addComment}
              onCancel={() => setPending(null)}
              onChange={(id, patch) => setNotes(comments.map((c) => (c.id === id ? { ...c, ...patch } : c)))}
              onDelete={(id) => setNotes(comments.filter((c) => c.id !== id))}
              onJump={(c) => {
                jumpTo(c)
                if (!window.matchMedia('(min-width: 768px)').matches) setPanel(null)
              }}
            />
          )}
          {panel === 'history' && (
            <HistoryPanel app={app.id} essay={essay.id} words={words} viewing={viewing?.id ?? null} onView={(id) => { viewVersion(id); if (!window.matchMedia('(min-width: 768px)').matches) setPanel(null) }} onSave={saveVersion} refresh={versionsTick} />
          )}
          {panel === 'coach' && (
          <>
          <div className="flex gap-2 px-5 pt-4">
            <Button size="sm" onClick={() => ask('outline')} loading={busy === 'outline'} disabled={!meta?.ai_configured || !!busy}>
              Structure
            </Button>
            <Button size="sm" variant="primary" onClick={() => ask('review')} loading={busy === 'review'} disabled={!meta?.ai_configured || !!busy || !text.trim()}>
              Review my draft
            </Button>
          </div>
          {openComments > 0 && (
            <p className="px-5 pt-2 text-xs text-muted">
              The review answers your {openComments} open {openComments === 1 ? 'comment' : 'comments'} too.
            </p>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-sm">
            {busy && (
              <p className="mb-4 flex items-center gap-2 text-muted">
                <Spinner className="text-live" /> Reading your {busy === 'outline' ? 'profile' : 'draft'}…
              </p>
            )}
            {coach ? <Markdown>{coach}</Markdown> : !busy && <p className="text-muted">Ask for a structure, or write and ask for a review. The coach never writes prose for you.</p>}
          </div>
          </>
          )}
        </aside>
      )}
    </div>
  )
}
