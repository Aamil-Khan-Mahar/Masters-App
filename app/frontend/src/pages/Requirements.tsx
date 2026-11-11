import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, isActive, type RequirementsRow, type ReqStatus } from '../api'
import { useData } from '../data'
import { appPath, cx, formatDate } from '../lib'
import { applyPath, inApply } from '../applyTasks'
import { REQ_GROUPS, isHardRequirement } from '../components/RequirementsChecklist'
import { Button, Chevron, Empty, PageHeader, Segmented, Spinner, Tag } from '../components/ui'

// Where degree-specific credit rules (ECTS per subject, required modules) are the norm.
const NOT_EUROPE = /^(canada|usa|united states|us|australia|new zealand|singapore|hong kong|japan|china|india|pakistan)$/i
const ORDER: Record<string, number> = { 'not met': 0, maybe: 1, unclear: 2, 'to do': 3, likely: 4 }
type Scope = 'europe' | 'all'

/** Every program's entry-requirements checklist side by side: what you don't meet yet, across the list. */
export default function Requirements() {
  const { apps, jobs, runBatch } = useData()
  const [rows, setRows] = useState<RequirementsRow[] | null>(null)
  const [scope, setScope] = useState<Scope>('europe')
  const working = jobs.filter((j) => j.kind === 'requirements' && isActive(j))
  const finished = jobs.filter((j) => j.kind === 'requirements' && j.status === 'done').length

  useEffect(() => {
    api.allRequirements().then(setRows).catch(() => setRows([]))
  }, [finished])

  if (!rows) return <Spinner className="text-live" />
  const list = rows.filter((r) => scope === 'all' || !NOT_EUROPE.test(r.country ?? ''))
  const missing = list.filter((r) => !r.summary && !working.some((j) => j.params?.app_id === r.id))
  const buildMissing = () => runBatch((strong) => api.buildRequirementsMany(missing.map((r) => r.id), strong), 'entry requirements').catch(() => undefined)
  const link = (r: RequirementsRow) => {
    const app = apps.find((a) => a.id === r.id)
    return app && inApply(app) ? `${applyPath(app)}&page=program&tab=requirements` : `${appPath(r.id)}?tab=requirements`
  }

  return (
    <>
      <PageHeader
        title="Entry requirements"
        subtitle="Each program's official rules, quoted exactly from its admission pages and statutes and checked against your courses, grades and tests. Open one to tick items off."
        actions={
          missing.length > 0 && (
            <Button variant="primary" onClick={buildMissing}>
              Build {missing.length} missing checklist{missing.length === 1 ? '' : 's'}
            </Button>
          )
        }
      />
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <Segmented<Scope>
          value={scope}
          onChange={setScope}
          options={[
            { id: 'europe', label: 'Europe' },
            { id: 'all', label: 'All programs' },
          ]}
        />
        {working.length > 0 && (
          <span className="text-sm text-live">
            {working.length} checklist{working.length === 1 ? '' : 's'} queued, built one at a time
          </span>
        )}
      </div>

      {!list.length ? (
        <Empty title="No programs here" />
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {list.map((r) => {
            const job = working.find((j) => j.params?.app_id === r.id)
            const open = [...r.open].sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9))
            const risky = open.filter((o) => isHardRequirement(o) && ['not met', 'maybe', 'unclear'].includes(o.status))
            return (
              <li key={r.id}>
                <Link to={link(r)} className="group grid gap-x-6 gap-y-2 py-4 sm:grid-cols-[minmax(14rem,22rem)_minmax(0,1fr)_auto]">
                  <div className="min-w-0">
                    <div className="font-display text-lg leading-tight">{r.university}</div>
                    <div className="text-sm text-text/85">{r.name}</div>
                    <div className="mt-0.5 text-xs text-muted">{r.country}</div>
                  </div>
                  <div className="min-w-0">
                    {job ? (
                      <span className="text-sm text-live">{job.status === 'waiting' ? 'Waiting for a free agent' : job.activity[job.activity.length - 1]?.text ?? 'Working'}</span>
                    ) : !r.summary ? (
                      <span className="text-sm text-muted">No checklist yet</span>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-2">
                          <Tag family="eligibility" value={r.summary.verdict} />
                          {(['not met', 'maybe', 'unclear', 'to do', 'likely', 'met'] as ReqStatus[])
                            .filter((s) => r.summary!.counts[s])
                            .map((s) => (
                              <Tag key={s} family="req" value={s}>
                                {r.summary!.counts[s]} {s}
                              </Tag>
                            ))}
                          <span className="num text-xs text-muted">
                            {r.summary.done} of {r.summary.items} ticked, checked {formatDate(r.summary.checked_on)}
                          </span>
                        </div>
                        {risky.length > 0 && (
                          <ul className="mt-2 space-y-1 text-sm">
                            {risky.slice(0, 6).map((o) => (
                              <li key={o.key} className="flex gap-2">
                                <Tag family="req" value={o.status} className="shrink-0" />
                                <span className="min-w-0">
                                  {o.title}
                                  <span className="ml-2 text-xs text-muted">{REQ_GROUPS.find((g) => g.id === o.group)?.label}</span>
                                </span>
                              </li>
                            ))}
                            {risky.length > 6 && <li className="text-xs text-muted">and {risky.length - 6} more</li>}
                          </ul>
                        )}
                      </>
                    )}
                  </div>
                  <Chevron className={cx('hidden self-center text-muted group-hover:text-text sm:block')} />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
