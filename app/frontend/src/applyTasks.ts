import type { Application, Deadline, Profile, Recommender, Stage } from './api'
import { daysUntil, ESSAY_TYPES, essaysFor, formatDate, nextDeadline, shortDate } from './lib'

// Apply mode turns everything an application still needs into one short to-do list. Each task reads from the field
// that already tracks it (letter status, documents_ready, score_sends, expenses, stage), so both modes always agree.
// Statements and the resume have no field of their own, so "final" for those is kept in the README's `tasks_done`.

export type TaskKind = 'essay' | 'letter' | 'letters' | 'contact' | 'doc' | 'score' | 'resume' | 'fee' | 'check' | 'submit' | 'final'
export interface Task {
  key: string
  kind: TaskKind
  group: 'Write' | 'People' | 'Documents' | 'Scores' | 'Finish'
  title: string
  /** One or two words: "Not started", "Asked 2 Oct", "Sent". */
  status: string
  done: boolean
  /** Essay id, recommender id, document text, test name or list index, depending on kind. */
  ref?: string
  index?: number
  /** A required document you write rather than upload (program-specific questions, research interests). */
  write?: boolean
}
export const GROUPS: Task['group'][] = ['Write', 'People', 'Documents', 'Scores', 'Finish']

/** Stages that open in Apply mode. */
export const APPLY_STAGES: Stage[] = ['preparing', 'submitted', 'interview', 'decision']
export const inApply = (a: Application) => !a.archived && APPLY_STAGES.includes(a.stage)
export const isSubmitted = (a: Application) => a.stage !== 'researching' && a.stage !== 'shortlisted' && a.stage !== 'preparing'
export const applyPath = (a: Application | string, item?: string) =>
  `/apply?app=${encodeURIComponent(typeof a === 'string' ? a : a.id)}${item ? `&item=${encodeURIComponent(item)}` : ''}`

/** "Application (international; 2027 date not yet confirmed…)" -> "Application". */
export const shortLabel = (label: string) => label.split(/[(;:.,–]/)[0].trim().slice(0, 40) || label.slice(0, 40)
/** A required document's short name, as on the Documents page. */
export const docName = (d: string) => d.replace(/\s*\(.*?\)\s*/g, ' ').split(/[.;:]/)[0].trim()
export const docKey = (d: string) => docName(d).toLowerCase()
/** The first sentence of a researched note, for one-line facts. */
export const firstSentence = (s?: string) => (s ?? '').split(/(?<=[.;])\s/)[0].replace(/[.;]$/, '').trim()

/** Required documents that are writing, not files: program-specific questions, short answers, research interests, supervisors. */
export const WRITING = /question|psq|short answer|research (area|interest|proposal|statement)|potential supervisor|supervisors|writing sample|describe|explain/i
const COVERED_ELSEWHERE = /statement|essay|purpose|\bsop\b|\bsoi\b|resume|\bcv\b|curriculum|english|toefl|ielts|duolingo|pte\b|test score|\bgre\b|recommend|reference|letter/i
/** Faculty contact statuses as saved in the README (older ones too), and their short labels. */
export const CONTACT_STATUS: Record<string, string> = {
  'to contact': 'To email',
  emailed: 'Emailed',
  contacted: 'Emailed',
  'no reply': 'No reply',
  replied: 'Replied',
  meeting: 'Meeting',
  'not taking students': 'Not taking',
  declined: 'Not taking',
}
const CONTACT_DONE = ['replied', 'meeting', 'not taking students', 'declined']
const REC_STATUS: Record<string, string> = { planned: 'Not asked', requested: 'Asked', reminded: 'Reminded', submitted: 'Received' }

export function tasksFor(a: Application, profile: Profile | null, people: Recommender[]): Task[] {
  const done = new Set(a.tasks_done ?? [])
  const out: Task[] = []

  for (const e of essaysFor(a)) {
    const key = `essay:${e.id}`
    const started = (a.essays_started ?? []).includes(e.id)
    out.push({ key, kind: 'essay', group: 'Write', title: e.type === 'other' ? e.title : ESSAY_TYPES[e.type].label, status: done.has(key) ? 'Final' : started ? 'Draft' : 'Not started', done: done.has(key), ref: e.id })
  }
  if (a.kind === 'program') {
    const r = a.resume
    out.push({ key: 'resume', kind: 'resume', group: 'Write', title: 'Resume', status: done.has('resume') ? 'Final' : r ? `${r.pages} pages` : 'Not built', done: done.has('resume') })
  }

  if (a.recommenders.length === 0 && a.kind === 'program')
    out.push({ key: 'letters', kind: 'letters', group: 'People', title: 'Recommenders', status: 'None chosen', done: false })
  for (const r of a.recommenders) {
    const p = people.find((x) => x.id === r.id)
    const when = r.status === 'requested' && r.requested_on ? ` ${shortDate(r.requested_on)}` : ''
    out.push({ key: `letter:${r.id}`, kind: 'letter', group: 'People', title: p?.name ?? r.id, status: REC_STATUS[r.status] + when, done: r.status === 'submitted', ref: r.id })
  }

  // Supervisors you're tracking from the Faculty tab: emailing them is part of applying.
  ;(a.faculty ?? []).forEach((c, i) => {
    const label = CONTACT_STATUS[c.status] ?? 'To email'
    const status = label === 'Emailed' && c.contacted_on ? `Emailed ${shortDate(c.contacted_on)}` : label
    out.push({ key: `contact:${i}`, kind: 'contact', group: 'People', title: c.name, status, done: CONTACT_DONE.includes(c.status), index: i })
  })

  const docs = (a.admission?.documents ?? []).filter((d) => !COVERED_ELSEWHERE.test(d))
  const started = new Set(essaysFor(a).map((e) => e.from).filter(Boolean))
  for (const d of docs) {
    const ready = (a.documents_ready ?? []).includes(docKey(d))
    // Writing ones sit under Write until you start them; then the statement itself is the to-do.
    if (WRITING.test(d)) {
      if (!started.has(docKey(d))) out.push({ key: `doc:${docKey(d)}`, kind: 'doc', group: 'Write', title: docName(d), status: ready ? 'Done' : 'Not started', done: ready, ref: d, write: true })
      continue
    }
    out.push({ key: `doc:${docKey(d)}`, kind: 'doc', group: 'Documents', title: docName(d), status: ready ? 'Ready' : 'To do', done: ready, ref: d })
  }

  // Scores: tests you've taken or booked that this program asks for (all of them when it hasn't been researched).
  for (const t of profile?.tests ?? []) {
    if (!wantsTest(a, t.name)) continue
    const sent = a.score_sends?.[t.name]
    const booked = t.total == null
    const status = sent ? `Sent ${shortDate(sent)}` : booked ? (/^\d{4}-/.test(t.date) ? `Test ${shortDate(t.date)}` : 'Booked') : 'Not sent'
    out.push({ key: `score:${t.name}`, kind: 'score', group: 'Scores', title: `${t.name} scores`, status, done: !!sent, ref: t.name })
  }

  // Checklist items nothing above covers ("Names of 3 supervisors", anything you added yourself).
  const covered = (item: string) =>
    /fee|paid|submit/i.test(item) ||
    (COVERED_ELSEWHERE.test(item) && !/transcript/i.test(item)) ||
    (/transcript/i.test(item) && out.some((t) => t.kind === 'doc' && /transcript/i.test(t.title)))
  a.checklist.forEach((c, i) => {
    if (!covered(c.item)) out.push({ key: `check:${i}`, kind: 'check', group: 'Documents', title: c.item, status: c.done ? 'Done' : 'To do', done: c.done, index: i })
  })

  if (a.expenses.length === 0) out.push({ key: 'fee', kind: 'fee', group: 'Finish', title: 'Application fee', status: 'Not paid', done: false })
  a.expenses.forEach((e, i) => out.push({ key: `fee:${i}`, kind: 'fee', group: 'Finish', title: e.label || 'Fee', status: e.paid ? 'Paid' : 'Not paid', done: e.paid, index: i }))

  out.push({ key: 'submit', kind: 'submit', group: 'Finish', title: 'Submit', status: isSubmitted(a) ? 'Submitted' : 'Not yet', done: isSubmitted(a) })
  return out
}

/** Does this program want this test? English tests when it asks for English; the GRE unless it says it isn't needed. */
export function wantsTest(a: Application, name: string): boolean {
  const en = a.admission?.english ?? ''
  const gre = a.admission?.gre ?? ''
  if (/gre/i.test(name)) return !gre.trim() || !/not (required|accepted|considered|needed)|no gre|isn.t required|does not require/i.test(gre)
  if (!en.trim()) return true
  return new RegExp(name.split(/\s/)[0], 'i').test(en)
}

export function progress(tasks: Task[]): [number, number] {
  return [tasks.filter((t) => t.done).length, tasks.length]
}

/** The application deadline if there is one, otherwise the next open date. */
export function mainDeadline(a: Application): Deadline | undefined {
  const open = a.deadlines.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date ?? '') && !d.done && daysUntil(d.date) >= 0).sort((x, y) => x.date.localeCompare(y.date))
  const main = (d: Deadline) => /(application|admission|apply)/i.test(d.label) && !/open|portal|start/i.test(shortLabel(d.label))
  return open.find(main) ?? nextDeadline(a) ?? open[0]
}

/** An earlier date to act on before the main deadline (an internal scholarship deadline, a referee date), if any. */
export function earlierDeadline(a: Application): Deadline | undefined {
  const main = mainDeadline(a)
  return a.deadlines
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date ?? '') && !d.done && daysUntil(d.date) >= 0 && d !== main && (!main || d.date < main.date) && !/open|portal|start/i.test(shortLabel(d.label)))
    .sort((x, y) => x.date.localeCompare(y.date))[0]
}

export const dueLine = (d?: Deadline) => (d ? `${shortLabel(d.label)} ${formatDate(d.date)}` : 'No deadline yet')
