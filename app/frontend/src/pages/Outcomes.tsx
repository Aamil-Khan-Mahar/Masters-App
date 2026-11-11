import type { Application } from '../api'
import { useData } from '../data'
import { cx, shortName } from '../lib'
import { applyPath, isSubmitted } from '../applyTasks'
import { ApplyPage } from '../components/ApplyLayout'
import { OpenLink, Section, Tag } from '../components/ui'

const DECISIONS = ['admitted', 'waitlisted', 'rejected'] as const

/** Where every submitted application stands: waiting, interview, decision, and your answer. */
export default function Outcomes() {
  const { apps } = useData()
  const sent = apps.filter((a) => !a.archived && isSubmitted(a)).sort((a, b) => shortName(a).localeCompare(shortName(b)))
  const groups = [
    { title: 'Waiting', list: sent.filter((a) => !a.decision && a.stage !== 'interview') },
    { title: 'Interview', list: sent.filter((a) => !a.decision && a.stage === 'interview') },
    { title: 'Decided', list: sent.filter((a) => a.decision) },
  ]
  const admits = sent.filter((a) => a.decision === 'admitted').length

  return (
    <ApplyPage>
      <h1 className="font-display text-[2.4rem] leading-tight md:text-[3rem]">Outcomes</h1>
      <p className="mt-2 text-muted">
        {sent.length === 0 ? 'Nothing submitted yet. Mark an application submitted from its Submit to-do.' : `${sent.length} submitted, ${admits} admit${admits === 1 ? '' : 's'} so far.`}
      </p>
      <div className="mt-10 space-y-10">
        {groups.map((g) =>
          g.list.length ? (
            <Section key={g.title} title={g.title} count={g.list.length}>
              <ul className="divide-y divide-line">
                {g.list.map((a) => (
                  <OutcomeRow key={a.id} a={a} />
                ))}
              </ul>
            </Section>
          ) : null,
        )}
      </div>
    </ApplyPage>
  )
}

function OutcomeRow({ a }: { a: Application }) {
  const { update } = useData()
  const pill = (on: boolean) => cx('rounded-md px-2.5 py-1 text-xs', on ? 'bg-panel-2 text-text ring-1 ring-line-strong' : 'text-muted hover:text-text')
  const decide = (d: (typeof DECISIONS)[number] | null) => update(a.id, { decision: d, stage: d ? 'decision' : 'submitted', response: d === 'admitted' ? a.response : null })
  const respond = (r: 'accepted' | 'declined' | null) => update(a.id, { response: r, stage: r ? 'final' : 'decision' })
  return (
    <li className="flex flex-wrap items-center gap-x-6 gap-y-3 py-4">
      <div className="min-w-0 flex-1 basis-60">
        <div className="font-display text-[1.25rem] leading-tight">{shortName(a)}</div>
        <div className="truncate text-sm text-muted">{a.kind === 'program' ? a.name : a.provider}</div>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <button className={pill(a.stage === 'interview')} onClick={() => update(a.id, { stage: a.stage === 'interview' ? 'submitted' : 'interview' })} disabled={!!a.decision}>
          Interview
        </button>
        <span className="mx-1 h-4 w-px bg-line" aria-hidden />
        {DECISIONS.map((d) => (
          <button key={d} className={pill(a.decision === d)} onClick={() => decide(a.decision === d ? null : d)}>
            {d.charAt(0).toUpperCase() + d.slice(1)}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        {a.decision === 'admitted' &&
          (['accepted', 'declined'] as const).map((r) => (
            <button key={r} className={pill(a.response === r)} onClick={() => respond(a.response === r ? null : r)}>
              {r === 'accepted' ? 'Accept' : 'Decline'}
            </button>
          ))}
        {a.decision && <Tag family="decision" value={a.decision} />}
        {a.response && <Tag family="response" value={a.response} />}
      </div>
      <OpenLink to={applyPath(a)}>To-dos</OpenLink>
    </li>
  )
}
