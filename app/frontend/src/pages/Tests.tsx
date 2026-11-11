import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type TestResult } from '../api'
import { useData } from '../data'
import { appPath, countdown, cx, daysUntil, formatDate, shortName, todayISO } from '../lib'
import { Button, Empty, ExternalLink, Input, Label, Markdown, Modal, PageHeader, Section, Spinner, Tag } from '../components/ui'
import OpusToggle from '../components/OpusToggle'

const COMMON = ['TOEFL iBT', 'IELTS Academic', 'Duolingo English Test', 'PTE Academic', 'GRE General', 'GMAT', 'SAT', 'ACT']
const MAX: Record<string, number> = { 'TOEFL iBT': 120, 'IELTS Academic': 9, 'Duolingo English Test': 160, 'PTE Academic': 90, 'GRE General': 340, GMAT: 805, SAT: 1600, ACT: 36 }

/** "Fall 2027" -> the first day of term, roughly. */
function intakeISO(intake?: string): string | null {
  const m = intake?.match(/(fall|autumn|winter|spring|summer)?\s*(\d{4})/i)
  if (!m) return null
  const s = (m[1] ?? 'fall').toLowerCase()
  return `${m[2]}-${s === 'winter' ? '01' : s === 'spring' || s === 'summer' ? '05' : '09'}-01`
}

type Verdict = { tone: 'green' | 'red' | 'yellow' | 'grey'; label: string; detail: string }

/** Compare your English scores with the minimum a program states, when the text gives one. */
function englishVerdict(req: string | undefined, tests: TestResult[]): Verdict {
  if (!req) return { tone: 'grey', label: 'Unknown', detail: 'Not researched' }
  // Research notes sometimes quote *your* score; drop those sentences before looking for a minimum.
  req = req
    .split(/(?<=[.;])\s+/)
    .filter((x) => !/\b(your|applicant'?s|you have|valid until)\b/i.test(x))
    .join(' ')
  if (/no minimum|minimum[^.]*not (found|stated|listed|published)|isn't stated|not stated/i.test(req)) return { tone: 'grey', label: 'Check', detail: 'The program page states no minimum score' }
  const toefl = tests.find((t) => /toefl/i.test(t.name))
  const ielts = tests.find((t) => /ielts/i.test(t.name))
  const tMin = Number(/toefl[^0-9]{0,30}(\d{2,3})/i.exec(req)?.[1] ?? NaN)
  const iMin = Number(/ielts[^0-9]{0,30}(\d(?:\.\d)?)/i.exec(req)?.[1] ?? NaN)
  if (toefl?.total != null && !Number.isNaN(tMin)) return toefl.total >= tMin ? { tone: 'green', label: 'Meets', detail: `TOEFL ${toefl.total}, needs ${tMin}` } : { tone: 'red', label: 'Below', detail: `TOEFL ${toefl.total}, needs ${tMin}` }
  if (ielts?.total != null && !Number.isNaN(iMin)) return ielts.total >= iMin ? { tone: 'green', label: 'Meets', detail: `IELTS ${ielts.total}, needs ${iMin}` } : { tone: 'red', label: 'Below', detail: `IELTS ${ielts.total}, needs ${iMin}` }
  return { tone: 'grey', label: 'Check', detail: 'No minimum found to compare' }
}

function greVerdict(req: string | undefined): Verdict {
  if (!req) return { tone: 'grey', label: 'Unknown', detail: '' }
  if (/not (required|accepted|considered)|no gre|waived/i.test(req)) return { tone: 'green', label: /optional|encourag|recommend/i.test(req) ? 'Optional' : 'Not required', detail: req }
  if (/optional|recommend|encourag/i.test(req)) return { tone: 'yellow', label: 'Optional', detail: req }
  if (/required|must/i.test(req)) return { tone: 'red', label: 'Required', detail: req }
  return { tone: 'grey', label: 'Check', detail: req }
}

export default function Tests() {
  const { profile, setProfile, apps, toast, runJob, runningJob, meta } = useData()
  const [note, setNote] = useState('')
  const busy = runningJob('tests')
  const lastLog = profile?.tests_log?.[0]
  const tell = (readReports: boolean) => {
    if (busy || (!readReports && !note.trim())) return
    runJob((strong) => api.testsAsk(note.trim(), readReports, strong))
      .then(() => setNote(''))
      .catch(() => undefined)
  }
  const [editing, setEditing] = useState<{ index: number | null; test: TestResult } | null>(null)
  const tests = profile?.tests ?? []
  const intake = intakeISO(profile?.target_intake)
  // Shortlisted onward: programs still being researched don't need test planning yet.
  const programs = apps.filter((a) => a.kind === 'program' && !a.archived && a.stage !== 'researching')

  const save = async (next: TestResult[]) => {
    if (!profile) return
    const p = { ...profile, tests: next }
    setProfile(p)
    try {
      setProfile(await api.saveProfile(p))
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  return (
    <>
      <PageHeader
        title="Tests"
        subtitle="Your scores, when they expire, how they compare with each program's minimum, and where you've sent them. Saved in Common/Profile.md, so Claude reads them too."
        actions={
          <Button variant="ghost" onClick={() => setEditing({ index: null, test: { name: 'TOEFL iBT', date: todayISO(), total: null, max: 120, sections: [], expires: null, file: '' } })}>
            Add by hand
          </Button>
        }
      />

      <section className="mb-10 max-w-[1400px]" aria-label="Tell Claude about a test">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            tell(false)
          }}
          className="flex flex-col gap-2 rounded-lg border border-line-strong bg-panel p-2 sm:flex-row sm:items-center"
        >
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Tell Claude, e.g. “booked IELTS Academic for 12 Dec” or “GRE 325, V160 Q165 AW4.5, 2 Oct”"
            className="min-w-0 flex-1 bg-transparent px-3 py-2 text-base outline-none placeholder:text-muted"
            disabled={!meta?.ai_configured}
            aria-label="Tell Claude about a test"
          />
          <div className="flex flex-wrap items-center gap-2 px-1 pb-1 sm:pb-0">
            <OpusToggle className="h-9" />
            <Button type="button" onClick={() => tell(true)} disabled={!meta?.ai_configured || !!busy} title="Reads every PDF in Common/Test-Scores. Only score lines are sent; name, address and ID numbers stay on this computer.">
              Read my score reports
            </Button>
            <Button type="submit" variant="primary" disabled={!meta?.ai_configured || !note.trim() || !!busy}>
              Update
            </Button>
          </div>
        </form>
        {busy ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-muted">
            <Spinner className="text-live" /> {busy.agent} is updating your tests: {busy.activity?.[busy.activity.length - 1]?.text ?? 'starting'}
          </p>
        ) : (
          lastLog && (
            <div className="mt-3 border-l-2 border-line-strong pl-4 text-sm">
              <span className="text-muted">
                {lastLog.note}, {formatDate(lastLog.at.slice(0, 10))}:{' '}
              </span>
              <span className="inline [&_p]:inline">
                <Markdown>{lastLog.answer}</Markdown>
              </span>
            </div>
          )
        )}
      </section>

      {tests.length === 0 ? (
        <Empty title="No test scores yet">Tell Claude above, or put your score report PDFs in Common/Test-Scores and press Read my score reports.</Empty>
      ) : (
        <div className="mb-12 grid gap-4 md:grid-cols-2 3xl:grid-cols-3">
          {tests.map((t, i) => {
            const expiresBeforeIntake = t.expires && intake && t.expires < intake
            const booked = t.total == null && daysUntil(t.date) >= 0
            return (
              <article key={`${t.name}-${t.date}`} className="flex flex-col rounded-lg border border-line bg-panel p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-display text-[1.4rem] leading-tight">{t.name}</h3>
                    <p className="text-sm text-muted">
                      {booked ? 'Booked for' : 'Taken'} {formatDate(t.date)}
                    </p>
                  </div>
                  {t.total != null ? (
                    <div className="text-right">
                      <div className="num font-display text-[2.4rem] leading-none">{t.total}</div>
                      {t.max && <div className="text-sm text-muted">of {t.max}</div>}
                    </div>
                  ) : (
                    <Tag tone="blue">{booked ? `In ${countdown(t.date)}` : 'No score yet'}</Tag>
                  )}
                </div>
                {t.sections.length > 0 && (
                  <dl className="mt-4 grid grid-cols-4 gap-3 border-t border-line pt-3">
                    {t.sections.map((s) => (
                      <div key={s.name}>
                        <dt className="truncate text-xs text-muted">{s.name}</dt>
                        <dd className="num text-base">
                          {s.score ?? '–'}
                          {s.max ? <span className="text-xs text-muted"> / {s.max}</span> : null}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
                <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
                  {t.expires && (
                    <Tag tone={daysUntil(t.expires) < 0 ? 'red' : expiresBeforeIntake ? 'orange' : 'green'} title={expiresBeforeIntake ? 'Expires before your intake starts; some visas and late-starting programs check validity at enrolment' : undefined}>
                      {daysUntil(t.expires) < 0 ? 'Expired' : `Valid until ${formatDate(t.expires)}`}
                    </Tag>
                  )}
                  {expiresBeforeIntake && <span className="text-t-orange">before your intake</span>}
                  {t.notes && <span className="text-muted">{t.notes}</span>}
                </div>
                <div className="mt-auto flex items-center gap-3 border-t border-line pt-3 text-sm">
                  {t.file ? <ExternalLink href={api.fileUrl(t.file)}>Score report</ExternalLink> : <span className="text-muted">No report attached</span>}
                  <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setEditing({ index: i, test: t })}>
                    Edit
                  </Button>
                </div>
              </article>
            )
          })}
        </div>
      )}

      <div>
        <Section title="What each program asks for" count={programs.length}>
          {programs.length === 0 ? (
            <p className="py-3 text-sm text-muted">No shortlisted programs yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {programs.map((a) => {
                const en = englishVerdict(a.admission?.english, tests)
                const gre = greVerdict(a.admission?.gre)
                return (
                  <li key={a.id} className="py-3.5">
                    <div className="flex items-center gap-3">
                      <Link to={`${appPath(a)}?tab=profile`} className="min-w-0 flex-1 truncate hover:text-live">
                        {shortName(a)}
                      </Link>
                      <span className="text-xs text-muted">English</span>
                      <Tag tone={en.tone} title={en.detail}>
                        {en.label}
                      </Tag>
                      <span className="text-xs text-muted">GRE</span>
                      <Tag tone={gre.tone} title={gre.detail}>
                        {gre.label}
                      </Tag>
                    </div>
                    {a.admission?.english && <p className="mt-1 line-clamp-2 text-sm text-muted">{a.admission.english}</p>}
                  </li>
                )
              })}
            </ul>
          )}
        </Section>

      </div>

      {editing && (
        <TestForm
          initial={editing.test}
          isNew={editing.index === null}
          onClose={() => setEditing(null)}
          onSave={(t) => {
            const next = [...tests]
            if (editing.index === null) next.push(t)
            else next[editing.index] = t
            save(next.sort((a, b) => b.date.localeCompare(a.date)))
            setEditing(null)
          }}
          onDelete={() => {
            if (editing.index === null) return
            if (!confirm(`Remove ${editing.test.name} (${formatDate(editing.test.date)})?`)) return
            save(tests.filter((_, i) => i !== editing.index))
            setEditing(null)
          }}
        />
      )}
    </>
  )
}

function TestForm({ initial, isNew, onClose, onSave, onDelete }: { initial: TestResult; isNew: boolean; onClose: () => void; onSave: (t: TestResult) => void; onDelete: () => void }) {
  const [t, setT] = useState<TestResult>(initial)
  const [sections, setSections] = useState(initial.sections.map((s) => `${s.name} ${s.score ?? ''}${s.max ? `/${s.max}` : ''}`).join(', '))
  const num = (v: string) => (v.trim() === '' ? null : Number(v))
  const parseSections = () =>
    sections
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => {
        const m = /^(.*?)\s+([\d.]+)?(?:\s*\/\s*([\d.]+))?$/.exec(x)
        return m ? { name: m[1], score: m[2] ? Number(m[2]) : null, max: m[3] ? Number(m[3]) : null } : { name: x, score: null, max: null }
      })
  return (
    <Modal open onClose={onClose} title={isNew ? 'Add a test' : `Edit ${initial.name}`}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          onSave({ ...t, sections: parseSections() })
        }}
      >
        <div>
          <Label>Test</Label>
          <Input list="test-names" value={t.name} onChange={(e) => setT({ ...t, name: e.target.value, max: MAX[e.target.value] ?? t.max })} required />
          <datalist id="test-names">
            {COMMON.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label hint="taken or booked">Date</Label>
            <Input type="date" value={t.date} onChange={(e) => setT({ ...t, date: e.target.value })} required />
          </div>
          <div>
            <Label>Valid until</Label>
            <Input type="date" value={t.expires ?? ''} onChange={(e) => setT({ ...t, expires: e.target.value || null })} />
          </div>
          <div>
            <Label hint="blank if booked">Total score</Label>
            <Input type="number" step="any" value={t.total ?? ''} onChange={(e) => setT({ ...t, total: num(e.target.value) })} />
          </div>
          <div>
            <Label>Out of</Label>
            <Input type="number" step="any" value={t.max ?? ''} onChange={(e) => setT({ ...t, max: num(e.target.value) })} />
          </div>
        </div>
        <div>
          <Label hint="comma-separated">Sections</Label>
          <Input value={sections} onChange={(e) => setSections(e.target.value)} placeholder="Reading 30/30, Listening 26/30, Speaking 26/30, Writing 28/30" />
        </div>
        <div>
          <Label hint="path under Common/">Score report</Label>
          <Input value={t.file} onChange={(e) => setT({ ...t, file: e.target.value })} placeholder="Test-Scores/IELTS-2026-03-01.pdf" />
        </div>
        <div>
          <Label>Notes</Label>
          <Input value={t.notes ?? ''} onChange={(e) => setT({ ...t, notes: e.target.value })} placeholder="CEFR C1, MyBest score…" />
        </div>
        <div className={cx('flex items-center gap-2 pt-2', isNew ? 'justify-end' : 'justify-between')}>
          {!isNew && (
            <Button type="button" variant="danger" onClick={onDelete}>
              Remove test
            </Button>
          )}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" type="submit">
              Save test
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
