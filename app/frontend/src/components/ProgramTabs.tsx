import { useEffect, useState, type MouseEvent, type ReactNode } from 'react'
import type { Application, Stage } from '../api'
import { useData } from '../data'
import { cx, STAGES } from '../lib'
import FacultyDirectory from './FacultyDirectory'
import FundingTab from './FundingTab'
import ProgramProfile from './ProgramProfile'
import RequirementsChecklist, { RequirementsMoney, reqLabel } from './RequirementsChecklist'
import { Textarea } from './ui'

export type ProgramTab = 'details' | 'requirements' | 'supervisors' | 'funding'
export const PROGRAM_TABS: ProgramTab[] = ['details', 'requirements', 'supervisors', 'funding']

/** Old ?tab= values from before the four-tab layout. */
export function programTab(raw: string | null): ProgramTab {
  if (raw && (PROGRAM_TABS as string[]).includes(raw)) return raw as ProgramTab
  if (raw === 'faculty') return 'supervisors'
  return 'details'
}

/** A program, one place for each thing: what it is, what it asks of you, who could supervise you, and the money. */
export default function ProgramTabs({ app, tab, onTab, supervisors }: {
  app: Application
  tab: ProgramTab
  onTab: (t: ProgramTab) => void
  /** Apply mode adds your supervisor contacts above the faculty list. */
  supervisors?: ReactNode
}) {
  const tabs: { id: ProgramTab; label: string }[] = [
    { id: 'details', label: 'Program details' },
    { id: 'requirements', label: reqLabel(app).replace('Entry requirements', 'Requirements') },
    { id: 'supervisors', label: `Possible supervisors${app.faculty_profiles?.length ? ` ${app.faculty_profiles.length}` : ''}` },
    { id: 'funding', label: 'Funding and money' },
  ]
  return (
    <>
      <ProgramComment app={app} />
      {/* The stage sits outside the scrolling tab strip so it never slides off-screen on a phone. */}
      <div className="mb-8 flex flex-wrap-reverse items-end gap-x-6 gap-y-3 border-b border-line">
        <nav className="no-scrollbar flex min-w-0 flex-1 gap-6 overflow-x-auto" aria-label="Program sections">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => onTab(t.id)}
              className={cx('-mb-px shrink-0 border-b-2 pb-2.5 text-sm whitespace-nowrap', tab === t.id ? 'border-live text-text' : 'border-transparent text-muted hover:text-text')}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <StageSelect app={app} />
      </div>
      {tab === 'details' && <ProgramProfile app={app} />}
      {tab === 'requirements' && <RequirementsChecklist app={app} />}
      {tab === 'supervisors' && (
        <div className="space-y-10">
          {supervisors}
          <FacultyDirectory app={app} />
        </div>
      )}
      {tab === 'funding' && (
        <div className="space-y-10">
          <FundingTab app={app} />
          <RequirementsMoney app={app} />
        </div>
      )}
    </>
  )
}

/** The program's stage, changeable from any tab (end of the tab bar) or from its card (`compact`). Inside a card
 *  link, clicks stop here so picking a stage doesn't open the program. */
export function StageSelect({ app, compact }: { app: Application; compact?: boolean }) {
  const { update } = useData()
  const stop = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }
  return (
    <label className={cx('flex shrink-0 items-center gap-2 text-sm text-muted', !compact && 'pb-2')} onClick={compact ? stop : undefined}>
      {compact ? <span className="sr-only">Stage</span> : 'Stage'}
      <select
        value={app.stage}
        onChange={(e) => update(app.id, { stage: e.target.value as Stage })}
        className={cx('rounded-md border border-line-strong bg-bg text-text', compact ? 'h-7 px-1.5 text-xs' : 'h-8 px-2 text-sm')}
        title="Move to another stage"
      >
        {STAGES.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Your own overall take on the program, written by you. Saved as README `comment`. */
export function ProgramComment({ app }: { app: Application }) {
  const { update } = useData()
  const [text, setText] = useState(app.comment ?? '')
  useEffect(() => setText(app.comment ?? ''), [app.id, app.comment])
  const save = () => text !== (app.comment ?? '') && update(app.id, { comment: text })
  return (
    <div className="mb-8">
      <label htmlFor={`comment-${app.id}`} className="mb-1.5 block text-xs text-muted">
        My overall comment
      </label>
      <Textarea
        id={`comment-${app.id}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        rows={Math.min(8, Math.max(2, text.split('\n').length + 1))}
        placeholder="Your take on this program: worth it or not, and why."
        className="w-full max-w-[90ch] text-sm leading-relaxed"
      />
    </div>
  )
}
