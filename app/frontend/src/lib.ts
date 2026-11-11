import type { Application, Deadline, Essay, EssayType, Profile, Stage, TestResult } from './api'

// ---------------------------------------------------------------- tags
// Colour on tags is categorical and fixed per value, so "Reach" is red on every page.
export type Tone = 'red' | 'orange' | 'yellow' | 'green' | 'teal' | 'blue' | 'violet' | 'pink' | 'grey'
export const TONE: Record<Tone, string> = {
  red: 'text-t-red bg-t-red/12 ring-t-red/30',
  orange: 'text-t-orange bg-t-orange/12 ring-t-orange/30',
  yellow: 'text-t-yellow bg-t-yellow/12 ring-t-yellow/30',
  green: 'text-t-green bg-t-green/12 ring-t-green/30',
  teal: 'text-t-teal bg-t-teal/12 ring-t-teal/30',
  blue: 'text-t-blue bg-t-blue/12 ring-t-blue/30',
  violet: 'text-t-violet bg-t-violet/12 ring-t-violet/30',
  pink: 'text-t-pink bg-t-pink/12 ring-t-pink/30',
  grey: 'text-t-grey bg-t-grey/10 ring-t-grey/25',
}
export const DOT: Record<Tone, string> = {
  red: 'bg-t-red', orange: 'bg-t-orange', yellow: 'bg-t-yellow', green: 'bg-t-green', teal: 'bg-t-teal',
  blue: 'bg-t-blue', violet: 'bg-t-violet', pink: 'bg-t-pink', grey: 'bg-t-grey',
}

/** Every tag family and the tone of each value. Unknown values fall back to grey. */
export const TAGS: Record<string, Record<string, Tone>> = {
  tier: { reach: 'red', target: 'yellow', safety: 'green' },
  stage: { researching: 'grey', shortlisted: 'blue', preparing: 'orange', submitted: 'violet', interview: 'teal', decision: 'yellow', final: 'green', dropped: 'grey' },
  decision: { admitted: 'green', waitlisted: 'orange', rejected: 'red' },
  response: { accepted: 'green', declined: 'grey' },
  rec: { planned: 'grey', requested: 'blue', reminded: 'orange', submitted: 'green' },
  category: { academic: 'violet', industry: 'teal', professional: 'teal' },
  match: { strong: 'green', possible: 'yellow', weak: 'grey' },
  accepting: { yes: 'green', no: 'red', unknown: 'grey' },
  how: { automatic: 'green', nomination: 'orange', application: 'blue' },
  guaranteed: { yes: 'green', partial: 'yellow', no: 'red', unknown: 'grey' },
  kind: { program: 'blue', scholarship: 'violet' },
  faculty: { 'to contact': 'grey', contacted: 'blue', replied: 'green', declined: 'red' },
  essay: { sop: 'blue', soi: 'violet', personal: 'teal', research: 'orange', other: 'grey' },
  check: { met: 'green', partial: 'yellow', missing: 'red', unclear: 'grey' },
  req: { met: 'green', likely: 'teal', maybe: 'yellow', 'not met': 'red', unclear: 'orange', 'to do': 'blue', 'not applicable': 'grey' },
  reqkind: { must: 'violet', conditional: 'orange', scored: 'pink', document: 'blue', step: 'grey' },
  eligibility: { eligible: 'green', likely: 'green', 'at risk': 'yellow', 'not eligible': 'red', unclear: 'grey' },
}
export const tagTone = (family: string, value?: string | null): Tone => TAGS[family]?.[(value ?? '').toLowerCase()] ?? 'grey'

export const STAGES: { id: Stage; label: string; color: string; dot: string }[] = (
  [
    ['researching', 'Researching'],
    ['shortlisted', 'Shortlisted'],
    ['preparing', 'Preparing'],
    ['submitted', 'Submitted'],
    ['interview', 'Interview'],
    ['decision', 'Decision'],
    ['final', 'Accepted / Declined'],
    ['dropped', 'Not considering'],
  ] as [Stage, string][]
).map(([id, label]) => ({ id, label, color: TONE[tagTone('stage', id)], dot: DOT[tagTone('stage', id)] }))
export const stageInfo = (s: Stage) => STAGES.find((x) => x.id === s) ?? STAGES[0]

export const REC_STATUSES = ['planned', 'requested', 'reminded', 'submitted'] as const
export const REC_COLORS: Record<string, string> = Object.fromEntries(REC_STATUSES.map((r) => [r, TONE[tagTone('rec', r)]]))
export const TIER_COLORS: Record<string, string> = Object.fromEntries(['reach', 'target', 'safety'].map((t) => [t, TONE[tagTone('tier', t)]]))

const DAY = 86_400_000

export function todayISO() {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

export function daysUntil(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  const target = new Date(y, m - 1, d).getTime()
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return Math.round((target - today) / DAY)
}

/** One countdown format everywhere: "today", "tomorrow", "12 days", "4 months", "3 days ago". */
export function countdown(iso: string): string {
  const n = daysUntil(iso)
  if (n === 0) return 'today'
  if (n === 1) return 'tomorrow'
  if (n === -1) return 'yesterday'
  if (n < 0) return -n < 60 ? `${-n} days ago` : `${Math.round(-n / 30)} months ago`
  return n < 100 ? `${n} days` : `${Math.round(n / 30)} months`
}

export function urgencyClass(iso: string): string {
  const n = daysUntil(iso)
  if (n < 0) return 'text-muted'
  if (n <= 14) return 'text-danger'
  if (n <= 30) return 'text-accent'
  return 'text-text'
}

/** "16 Nov" style, no year: for lists where the year is obvious. */
export function shortDate(iso?: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m) return iso
  return new Date(y, m - 1, d || 1).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export function formatDate(iso?: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m) return iso
  return new Date(y, m - 1, d || 1).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

const isActive = (a: Application) => !a.archived && a.stage !== 'final' && a.decision !== 'rejected'

export function nextDeadline(a: Application): Deadline | undefined {
  return a.deadlines
    .filter((d) => d.date && !d.done && daysUntil(d.date) >= 0)
    .sort((x, y) => x.date.localeCompare(y.date))[0]
}

export interface DeadlineEvent extends Deadline { app: Application }

/** Programs and scholarships you haven't shortlisted yet: kept off Today, Calendar, Money and the rest unless asked for. */
export const stillResearching = (a: Application) => a.stage === 'researching'

// Anything still in Researching stays off the calendar/deadline lists unless asked for.
export function allDeadlines(apps: Application[], includePast = false, includeResearching = false): DeadlineEvent[] {
  return apps
    .filter((a) => !a.archived && (includeResearching || !stillResearching(a)))
    .flatMap((a) => a.deadlines.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date ?? '')).map((d) => ({ ...d, app: a })))
    .filter((e) => includePast || daysUntil(e.date) >= 0)
    .sort((x, y) => x.date.localeCompare(y.date))
}

/** Dated test events: a booked sitting (no score yet) and the day scores stop being valid. They open the Tests page. */
export interface TestEvent { date: string; kind: 'test' | 'expiry'; title: string; label: string; test: TestResult }
export function testEvents(tests: TestResult[] | undefined, includePast = false): TestEvent[] {
  const out: TestEvent[] = []
  for (const t of tests ?? []) {
    if (t.total == null && /^\d{4}-\d{2}-\d{2}$/.test(t.date)) out.push({ date: t.date, kind: 'test', title: t.name, label: `Sit ${t.name}`, test: t })
    if (t.expires && /^\d{4}-\d{2}-\d{2}$/.test(t.expires)) out.push({ date: t.expires, kind: 'expiry', title: t.name, label: `${t.name} scores expire`, test: t })
  }
  return out.filter((e) => includePast || daysUntil(e.date) >= 0).sort((a, b) => a.date.localeCompare(b.date))
}

export const ESSAY_TYPES: Record<EssayType, { label: string; short: string }> = {
  sop: { label: 'Statement of purpose', short: 'SOP' },
  soi: { label: 'Statement of interest', short: 'SOI' },
  personal: { label: 'Personal statement', short: 'Personal' },
  research: { label: 'Research statement', short: 'Research' },
  other: { label: 'Essay', short: 'Essay' },
  supervisor: { label: 'Supervisor email', short: 'Email' },
}

/** The first email to a supervisor you're tracking, shaped like a statement so the essay editor and coach can write it.
 * Mirrors store.supervisor_email: the id names its file (Essay-email-<name>.md). */
export function supervisorEmail(name: string): Essay {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 34).replace(/-+$/, '')
  return {
    id: `email-${slug || 'supervisor'}`,
    type: 'supervisor',
    title: `Email to ${name}`,
    person: name,
    prompt: `A first email to ${name}, a potential thesis supervisor, sent after applying. Short: about 200 words plus a subject line.`,
    limit: 200,
  }
}

/** An application's statements. Programs that never listed any get one (id "sop", so SOP.md stays attached), typed from the prompt. Mirrors store.essays_for. */
export function essaysFor(a: Application): Essay[] {
  if (a.essays?.length) return a.essays
  if (a.kind !== 'program') return []
  const type: EssayType = /statement of interest|\bSOI\b/i.test(a.sop_prompt ?? '') ? 'soi' : 'sop'
  return [{ id: 'sop', type, title: ESSAY_TYPES[type].label, prompt: a.sop_prompt ?? '', limit: null }]
}

/** "max 500 words", "500-word limit", "up to 1,000 words" -> 500 / 1000. */
export function wordLimit(prompt?: string): number | null {
  const m = /(?:max(?:imum)?|up to|limit(?:ed)? to|no more than)\s*(?:of\s*)?([\d,]{3,5})\s*words|([\d,]{3,5})[\s-]*words?\s*(?:max|limit|maximum)/i.exec(prompt ?? '')
  const n = m ? Number((m[1] ?? m[2]).replace(/,/g, '')) : NaN
  return Number.isNaN(n) ? null : n
}

export function active(apps: Application[]) {
  return apps.filter(isActive)
}

/** How you'd say it: "University of Example" -> "Example", "Stanford University (ICME)" -> "Stanford". */
export function shortName(a: Application): string {
  const base = a.kind === 'program' ? a.university || a.name : a.name
  return (
    base
      .replace(/\s*\(.*?\)\s*/g, ' ')
      .replace(/^(The )?University of /i, '')
      .replace(/ University$/i, '')
      .trim() || base
  )
}

/** Full institution name for programs, the award name for scholarships. */
export const fullName = (a: Application) => (a.kind === 'program' ? a.university || a.name : a.name)

/** Researched deadline labels are often a sentence plus notes; split into a short label and the rest. */
export function splitLabel(label: string): { title: string; note: string } {
  const m = label.match(/^(.{3,80}?)[.:;](\s|$)([\s\S]*)$/)
  if (!m) return { title: label, note: '' }
  return { title: m[1].trim(), note: m[3].trim() }
}

export function subtitle(a: Application): string {
  return a.kind === 'program'
    ? [a.university, a.country].filter(Boolean).join(', ')
    : [a.provider, a.country].filter(Boolean).join(', ')
}

export function weightedScore(a: Application, w: Profile['shortlist_weights']): number | null {
  const s = a.scores ?? {}
  const keys = ['fit', 'cost', 'admit', 'career'] as const
  if (keys.some((k) => typeof s[k] !== 'number')) return null
  const total = keys.reduce((t, k) => t + w[k], 0) || 1
  return Math.round((keys.reduce((t, k) => t + (s[k] as number) * w[k], 0) / total) * 10) / 10
}

export function checklistProgress(a: Application): [number, number] {
  return [a.checklist.filter((c) => c.done).length, a.checklist.length]
}

export function money(amount: number | null | undefined, currency = 'USD'): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '—'
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(amount)
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString()}`
  }
}

export const appPath = (a: Application | string) => `/app/${typeof a === 'string' ? a : a.id}`

/** Researched within the last 30 days; the research team skips fresh parts. */
export function isFresh(day: string | null | undefined) {
  return !!day && (Date.now() - new Date(day).getTime()) / 86400000 < 30
}

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}
