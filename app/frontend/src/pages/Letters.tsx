import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Application, type RecAssignment, type Recommender } from '../api'
import { useData } from '../data'
import { countdown, cx, daysUntil, formatDate, fullName, nextDeadline, REC_COLORS, REC_STATUSES, shortDate, shortName, splitLabel, urgencyClass } from '../lib'
import { Button, Empty, Input, Markdown, Modal, OpenLink, PageHeader, Section, Spinner, Tag, Textarea } from '../components/ui'
import OpusToggle from '../components/OpusToggle'
import { ApplyPage } from '../components/ApplyLayout'
import { applyPath, inApply } from '../applyTasks'

const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Each application's deadline and, if it has one, the separate deadline for letters. */
function letterDates(app: Application) {
  const open = app.deadlines.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date ?? '') && !d.done && daysUntil(d.date) >= 0)
  // Judge each date by its short name, not the notes researched into its label.
  const name = (d: { label: string }) => d.label.split(/[(;:.]/)[0]
  const referee = open.find((d) => /refere|reference|letter|recommend/i.test(name(d)))
  const apply = open.find((d) => /applica|admission/i.test(name(d)) && !/open|portal|start|refere|reference|letter|recommend/i.test(name(d)))
  return { apply, referee }
}

/** The list for a recommender who has already agreed: each application with its deadlines. No links. */
function requestEmail(person: Recommender, letters: { app: Application }[], me?: string) {
  const first = person.name.replace(/^(Dr\.?|Professor|Prof\.?)\s+/i, '').split(' ')[0]
  const title = /^(Dr|Professor|Prof)/i.test(person.name) ? person.name.split(' ').slice(0, 1).join(' ') + ' ' + person.name.split(' ').slice(-1) : first
  // Numbered blocks, the same layout the drafted email uses.
  const lines = letters.map(({ app }, i) => {
    const { apply, referee } = letterDates(app)
    const pad = ' '.repeat(String(i + 1).length + 2)
    return [
      `${i + 1}. ${app.kind === 'program' ? app.name : 'Scholarship application'}`,
      `${pad}${fullName(app)}`,
      `${pad}Application deadline: ${apply ? formatDate(apply.date) : 'not announced yet'}`,
      ...(referee ? [`${pad}Recommender deadline: ${formatDate(referee.date)}`] : []),
    ].join('\n')
  })
  return `Dear ${title},

Thank you again for agreeing to write a letter for me. Each program's portal will email you an invitation at ${person.email || 'your email'}. Here are the programs:

${lines.join('\n\n')}

Thank you very much for your time and support.

Best regards,
${me ?? ''}`
}

export default function Letters() {
  const { recommenders, apps, update, profile, setRecommenders, refresh, toast } = useData()
  const [open, setOpen] = useState<Recommender | null>(null)
  const [removing, setRemoving] = useState<Recommender | null>(null)
  const [busyRemove, setBusyRemove] = useState(false)

  // The order here is the order everywhere: these cards, the table's columns, and Claude's emails.
  const move = (i: number, to: number) => {
    const next = [...recommenders]
    const [r] = next.splice(i, 1)
    next.splice(to, 0, r)
    setRecommenders(next)
    api.saveRecommenderOrder(next.map((x) => x.id)).catch((e) => {
      toast((e as Error).message, 'error')
      refresh()
    })
  }
  const remove = async (r: Recommender) => {
    setBusyRemove(true)
    try {
      await api.removeRecommender(r.id)
      await refresh()
      toast(`${r.name} removed`)
      setRemoving(null)
      if (open?.id === r.id) setOpen(null)
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusyRemove(false)
    }
  }
  // Only what you're applying to. Letters assigned to one moved back to the shortlist stay saved and reappear when you apply again.
  const columns = apps.filter(inApply)

  const setCell = (app: Application, recId: string, status: string) => {
    const today = new Date().toISOString().slice(0, 10)
    const existing = app.recommenders.find((r) => r.id === recId)
    let next: RecAssignment[]
    if (!status) next = app.recommenders.filter((r) => r.id !== recId)
    else if (existing)
      next = app.recommenders.map((r) =>
        r.id === recId
          ? { ...r, status: status as RecAssignment['status'], requested_on: status === 'requested' && !r.requested_on ? today : r.requested_on, submitted_on: status === 'submitted' ? today : r.submitted_on }
          : r,
      )
    else next = [...app.recommenders, { id: recId, status: status as RecAssignment['status'], requested_on: status === 'requested' ? today : null, submitted_on: null }]
    update(app.id, { recommenders: next })
  }

  const lettersOf = (r: Recommender) => columns.flatMap((a) => a.recommenders.filter((x) => x.id === r.id).map((x) => ({ app: a, rec: x })))

  const statusSelect = (a: Application, r: Recommender, className = '') => {
    const cell = a.recommenders.find((x) => x.id === r.id)
    return (
      <select
        value={cell?.status ?? ''}
        onChange={(e) => setCell(a, r.id, e.target.value)}
        aria-label={`${r.name}'s letter for ${shortName(a)}`}
        className={cx('cursor-pointer rounded-md border-0 px-2 py-1.5 text-sm capitalize ring-1 ring-inset', cell ? REC_COLORS[cell.status] : 'bg-transparent text-muted ring-line', className)}
      >
        <option value="">Not asked</option>
        {REC_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    )
  }

  return (
    <ApplyPage>
      <PageHeader title="Letters" subtitle="Who is writing for which application, and when to ask. People come from Common/Recommenders/<name>/Info.md." />

      {recommenders.length === 0 ? (
        <Empty title="No recommenders yet">Add a folder per person under Common/Recommenders/ with an Info.md file, then reload.</Empty>
      ) : (
        <>
          <div className="mb-12 grid gap-4 sm:grid-cols-2 xl:grid-cols-3 4xl:grid-cols-4">
            {recommenders.map((r, i) => {
              const letters = lettersOf(r)
              const counts = REC_STATUSES.map((s) => [s, letters.filter((l) => l.rec.status === s).length] as const).filter(([, n]) => n)
              const toAsk = letters
                .filter((l) => l.rec.status === 'planned')
                .map((l) => nextDeadline(l.app)?.date)
                .filter(Boolean)
                .sort()[0]
              const askBy = toAsk ? addDays(toAsk, -28) : null
              return (
                <article key={r.id} className="flex flex-col rounded-lg border border-line bg-panel p-5">
                  <div className="flex items-start justify-between gap-3">
                    <button onClick={() => setOpen(r)} className="min-w-0 text-left hover:text-live">
                      <h3 className="font-display text-[1.25rem] leading-tight">{r.name}</h3>
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
                      <Tag family="category" value={r.category || 'Academic'} />
                      <Button size="sm" variant="ghost" className="w-7 px-0" onClick={() => move(i, i - 1)} disabled={i === 0} title="Move earlier" aria-label={`Move ${r.name} earlier`}>
                        <Chevron dir="left" />
                      </Button>
                      <Button size="sm" variant="ghost" className="w-7 px-0" onClick={() => move(i, i + 1)} disabled={i === recommenders.length - 1} title="Move later" aria-label={`Move ${r.name} later`}>
                        <Chevron dir="right" />
                      </Button>
                    </div>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-muted">{r.role}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {counts.length ? (
                      counts.map(([s, n]) => (
                        <Tag key={s} family="rec" value={s}>
                          {n} {s}
                        </Tag>
                      ))
                    ) : (
                      <span className="text-sm text-muted">No letters assigned</span>
                    )}
                  </div>
                  {askBy && (
                    <p className="mt-3 text-sm">
                      Ask by <span className="num font-medium">{shortDate(askBy)}</span>
                      <span className={cx('num', urgencyClass(askBy))}> ({countdown(askBy)})</span>
                    </p>
                  )}
                  <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3 text-sm">
                    {r.email && (
                      <a href={`mailto:${r.email}`} className="min-w-0 truncate text-live hover:underline">
                        {r.email}
                      </a>
                    )}
                    <div className="ml-auto flex gap-2">
                      <Button size="sm" variant="ghost" className="hover:text-danger" onClick={() => setRemoving(r)}>
                        Remove
                      </Button>
                      {letters.length > 0 && (
                        <Button size="sm" variant="ghost" onClick={() => setOpen(r)} title="The list of applications and deadlines to send them, with a personal P.S.">
                          Email
                        </Button>
                      )}
                      <Button size="sm" onClick={() => setOpen(r)}>
                        Open
                      </Button>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>

          {/* phone: one block per application */}
          <div className="space-y-8 md:hidden">
            {columns.length === 0 && <p className="text-sm text-muted">Start applying to a program and assign letters here.</p>}
            {columns.map((a) => (
              <Section key={a.id} title={shortName(a)} aside={<span className="num text-muted">{a.recommenders.filter((x) => x.status === 'submitted').length} of {a.recommenders.length} in</span>}>
                <ul className="divide-y divide-line">
                  {recommenders.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                      <span className="truncate text-sm">{r.name}</span>
                      {statusSelect(a, r, 'h-9 w-36 shrink-0')}
                    </li>
                  ))}
                </ul>
              </Section>
            ))}
          </div>

          {/* desktop: the full matrix */}
          <Section title="Letters by application" className="hidden md:block">
            {columns.length === 0 ? (
              <p className="py-3 text-sm text-muted">Start applying to a program and assign letters here.</p>
            ) : (
              <div className="overflow-x-auto pt-2">
                <table className="text-sm">
                  <thead>
                    <tr>
                      <th className="sticky left-0 bg-bg pr-6 pb-3 text-left font-normal text-muted">Application</th>
                      {recommenders.map((r) => (
                        <th key={r.id} className="min-w-44 px-2 pb-3 text-left align-bottom font-normal">
                          <button onClick={() => setOpen(r)} className="block text-left font-display text-base hover:text-live">
                            {r.name}
                          </button>
                        </th>
                      ))}
                      <th className="px-2 pb-3 text-left align-bottom font-normal text-muted">Submitted</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {columns.map((a) => {
                      const nd = nextDeadline(a)
                      return (
                        <tr key={a.id}>
                          <td className="sticky left-0 bg-bg py-2.5 pr-6 whitespace-nowrap">
                            <Link to={applyPath(a)} className="block hover:text-live">
                              {shortName(a)}
                            </Link>
                            {nd && <div className={cx('num text-xs', urgencyClass(nd.date))}>due {shortDate(nd.date)}</div>}
                          </td>
                          {recommenders.map((r) => (
                            <td key={r.id} className="px-2 py-2">
                              {statusSelect(a, r, 'w-full')}
                            </td>
                          ))}
                          <td className="num px-2 py-2.5 whitespace-nowrap text-muted">
                            {a.recommenders.filter((x) => x.status === 'submitted').length} of {a.recommenders.length}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </>
      )}

      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.name ?? ''} wide>
        {open && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Tag family="category" value={open.category || 'Academic'} />
              <span className="text-muted">{open.role}</span>
              {open.email && (
                <a href={`mailto:${open.email}`} className="text-live hover:underline">
                  {open.email}
                </a>
              )}
            </div>
            {lettersOf(open).length > 0 && (
              <ul className="divide-y divide-line border-y border-line">
                {lettersOf(open).map(({ app, rec }) => {
                  const nd = nextDeadline(app)
                  return (
                    <li key={app.id} className="flex items-center gap-3 py-2.5 text-sm">
                      <span className="min-w-0 flex-1 truncate">
                        {shortName(app)}
                        {nd && <span className="text-muted">, {splitLabel(nd.label).title.toLowerCase()} {shortDate(nd.date)}</span>}
                      </span>
                      <Tag family="rec" value={rec.status} />
                      <OpenLink to={applyPath(app)} />
                    </li>
                  )
                })}
              </ul>
            )}
            {lettersOf(open).length > 0 && <EmailDraft person={open} template={() => requestEmail(open, lettersOf(open).filter((l) => l.rec.status !== 'submitted').length ? lettersOf(open).filter((l) => l.rec.status !== 'submitted') : lettersOf(open), profile?.name)} />}
            <div className="max-h-[50vh] overflow-y-auto pr-2">
              <Markdown>{open.body}</Markdown>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!removing} onClose={() => !busyRemove && setRemoving(null)} title={removing ? `Remove ${removing.name}?` : ''}>
        {removing && (
          <div className="space-y-5 text-sm">
            <p>
              They come off this page and off {lettersOf(removing).length ? `the ${lettersOf(removing).length} application${lettersOf(removing).length === 1 ? '' : 's'} they're writing for` : 'every application'}. Their folder and notes move to
              Common/Recommenders-removed; nothing is deleted. Move the folder back to bring them back.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setRemoving(null)} disabled={busyRemove}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => remove(removing)} loading={busyRemove}>
                Remove
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </ApplyPage>
  )
}

const Chevron = ({ dir }: { dir: 'left' | 'right' }) => (
  <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={dir === 'left' ? 'M10 3.5 5.5 8 10 12.5' : 'M6 3.5 10.5 8 6 12.5'} />
  </svg>
)

/**
 * The email for one recommender: which invitations to expect, at which address, by when, and how far along each letter
 * is, with a personal P.S. Claude drafts it from their notes; you edit it here. Nothing is ever sent from the app.
 */
function EmailDraft({ person, template }: { person: Recommender; template: () => string }) {
  const { runJob, runningJob, meta, toast } = useData()
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [at, setAt] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const busy = runningJob('letter-email')
  const mine = busy?.params?.name === person.id ? busy : undefined

  const load = () =>
    api.letterEmail(person.id).then((d) => {
      setSubject(d.subject)
      setBody(d.body)
      setAt(d.at)
      setLoaded(true)
    })
  useEffect(() => {
    load().catch(() => setLoaded(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person.id])

  const draft = () => runJob((strong) => api.draftLetterEmail(person.id, strong)).then((j) => {
      if (j.status === 'done') load()
    }).catch(() => undefined)
  const save = () => api.saveLetterEmail(person.id, subject, body).then((d) => setAt(d.at)).catch((e) => toast((e as Error).message, 'error'))
  const useTemplate = () => {
    const text = template()
    setSubject('My applications: the reference invitations you will receive')
    setBody(text)
    api.saveLetterEmail(person.id, 'My applications: the reference invitations you will receive', text).then((d) => setAt(d.at)).catch(() => undefined)
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`)
      toast(`Email to ${person.name} copied`)
    } catch {
      toast('Could not copy to the clipboard', 'error')
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto font-display text-lg">Email to {person.name}</h3>
        <OpusToggle className="h-7" />
        <Button size="sm" variant={body ? 'ghost' : 'primary'} onClick={draft} loading={!!mine} disabled={!meta?.ai_configured || !!busy}>
          {body ? 'Redraft with Claude' : 'Draft with Claude'}
        </Button>
        {!body && (
          <Button size="sm" variant="ghost" onClick={useTemplate}>
            Plain template
          </Button>
        )}
      </div>
      {mine && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner className="text-live" /> {mine.activity?.[mine.activity.length - 1]?.text ?? 'Waiting for a free agent'}
        </p>
      )}
      {!loaded ? (
        <Spinner className="text-muted" />
      ) : body || subject ? (
        <>
          <div className="text-sm">
            <span className="text-muted">To </span>
            {person.email || <span className="text-danger">no email in their Info.md</span>}
          </div>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} onBlur={save} aria-label="Subject" />
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} onBlur={save} rows={16} className="font-sans text-sm leading-relaxed" aria-label="Email" />
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Button size="sm" onClick={copy}>
              Copy
            </Button>
            {person.email && (
              <a href={`mailto:${person.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`} className="text-live hover:underline">
                Open in my mail app
              </a>
            )}
            <span className="ml-auto text-xs text-muted">{at ? `Saved ${formatDate(at.slice(0, 10))}` : ''} in their folder as Request-email.md</span>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted">Claude writes it from their notes: a thank-you, the address the invitations go to, each application with its deadline (and the recommender deadline where there is one), and a P.S. asking for what only they can speak to. No links. Nothing is sent from here.</p>
      )}
    </section>
  )
}
