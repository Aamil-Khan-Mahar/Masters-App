import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../data'
import { allDeadlines, countdown, cx, shortDate, shortName, splitLabel, testEvents, todayISO, urgencyClass, type DeadlineEvent } from '../lib'
import { Button, PageHeader, Row, Section, Tag, ViewSwitch } from '../components/ui'
import { ApplyPage } from '../components/ApplyLayout'
import { applyPath, inApply } from '../applyTasks'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** One .ics file with every upcoming deadline, for Google / Apple / Outlook calendars. */
function downloadIcs(events: DeadlineEvent[]) {
  const esc = (t: string) => t.replace(/[\\,;]/g, (c) => '\\' + c).replace(/\n/g, '\\n')
  const day = (iso: string) => iso.replace(/-/g, '')
  const next = (iso: string) => {
    const d = new Date(iso + 'T00:00')
    d.setDate(d.getDate() + 1)
    return d.toISOString().slice(0, 10).replace(/-/g, '')
  }
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Applications//Deadlines//EN', 'CALSCALE:GREGORIAN']
  for (const e of events) {
    const { title, note } = splitLabel(e.label)
    lines.push(
      'BEGIN:VEVENT',
      `UID:${day(e.date)}-${encodeURIComponent(e.app.id).slice(0, 60)}-${encodeURIComponent(title).slice(0, 30)}@applications`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
      `DTSTART;VALUE=DATE:${day(e.date)}`,
      `DTEND;VALUE=DATE:${next(e.date)}`,
      `SUMMARY:${esc(`${shortName(e.app)}: ${title}`)}`,
      `DESCRIPTION:${esc([e.app.name, note].filter(Boolean).join('\n'))}`,
      'BEGIN:VALARM',
      'TRIGGER:-P7D',
      'ACTION:DISPLAY',
      `DESCRIPTION:${esc(`${shortName(e.app)} ${title} in a week`)}`,
      'END:VALARM',
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'application-deadlines.ics'
  a.click()
  URL.revokeObjectURL(url)
}

export default function Calendar() {
  const { apps, profile } = useData()
  const now = new Date()
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() })
  const [phoneView, setPhoneView] = useState<'list' | 'month'>('list')
  // Only what you're applying to; research-stage dates live with each program in Research mode.
  const events = allDeadlines(apps.filter(inApply), true)
  const today = todayISO()
  const upcoming = events.filter((e) => e.date >= today && !e.done)
  // Booked tests and score expiry, shown alongside deadlines; they open the Tests page.
  const tests = testEvents(profile?.tests, true)
  type Item = { date: string; name: string; what: string; to: string; done?: boolean; tag?: 'scholarship' | 'test' | 'expiry' }
  const items: Item[] = [
    ...events.map((e) => ({ date: e.date, name: shortName(e.app), what: splitLabel(e.label).title, to: applyPath(e.app), done: e.done, tag: e.app.kind === 'scholarship' ? ('scholarship' as const) : undefined })),
    ...tests.map((e) => ({ date: e.date, name: e.kind === 'test' ? e.title : `${e.title} expires`, what: e.kind === 'test' ? 'Booked test' : 'Scores stop being valid', to: '/you/tests', tag: e.kind })),
  ].sort((a, b) => a.date.localeCompare(b.date))
  const upcomingItems = items.filter((e) => e.date >= today && !e.done)

  const first = new Date(cursor.y, cursor.m, 1)
  const offset = (first.getDay() + 6) % 7 // Monday-first grid
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate()
  const cells = Math.ceil((offset + daysInMonth) / 7) * 7
  const iso = (d: number) => `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  const move = (delta: number) => setCursor(({ y, m }) => ({ y: m + delta < 0 ? y - 1 : m + delta > 11 ? y + 1 : y, m: (m + delta + 12) % 12 }))
  const monthName = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  // Agenda for phones: upcoming deadlines grouped by month.
  const byMonth = upcomingItems.reduce<Record<string, Item[]>>((acc, e) => {
    const k = e.date.slice(0, 7)
    ;(acc[k] ??= []).push(e)
    return acc
  }, {})

  return (
    <ApplyPage>
      <PageHeader
        title="Calendar"
        subtitle={`${upcoming.length} upcoming deadline${upcoming.length === 1 ? '' : 's'} across what you're applying to, plus your test dates.`}
        actions={
          <>
            <Button onClick={() => downloadIcs(upcoming)} disabled={upcoming.length === 0} title="Download an .ics file for Google, Apple or Outlook calendar, with a reminder a week before each deadline">
              Add to my calendar
            </Button>
          </>
        }
      />

      <div className="mb-5 md:hidden">
        <ViewSwitch
          value={phoneView}
          onChange={setPhoneView}
          views={[
            { id: 'list', label: 'List' },
            { id: 'month', label: 'Month' },
          ]}
        />
      </div>

      <div className="grid items-start gap-x-12 gap-y-8 xl:grid-cols-[minmax(0,1fr)_380px] 3xl:grid-cols-[minmax(0,1fr)_460px]">
        <div className={cx(phoneView === 'list' && 'hidden md:block')}>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="mr-auto font-display text-[1.6rem]">{monthName}</h2>
            <Button size="sm" variant="ghost" onClick={() => setCursor({ y: now.getFullYear(), m: now.getMonth() })}>
              Today
            </Button>
            <Button size="sm" onClick={() => move(-1)} aria-label="Previous month">
              ‹
            </Button>
            <Button size="sm" onClick={() => move(1)} aria-label="Next month">
              ›
            </Button>
          </div>
          <div className="overflow-hidden rounded-lg border border-line-strong">
            <div className="grid grid-cols-7 border-b border-line text-center text-xs text-muted">
              {WEEKDAYS.map((d) => (
                <div key={d} className="py-2">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {Array.from({ length: cells }, (_, i) => {
                const day = i - offset + 1
                const inMonth = day >= 1 && day <= daysInMonth
                const date = inMonth ? iso(day) : ''
                const dayEvents = inMonth ? items.filter((e) => e.date === date) : []
                return (
                  <div key={i} className={cx('min-h-16 border-r border-b border-line p-1 md:min-h-28 md:p-1.5 3xl:min-h-36 [&:nth-child(7n)]:border-r-0', !inMonth && 'bg-panel')}>
                    {inMonth && (
                      <>
                        <div className={cx('mb-1 grid h-6 w-6 place-items-center rounded-full text-xs', date === today ? 'bg-accent font-semibold text-black' : 'text-muted')}>{day}</div>
                        <div className="space-y-1">
                          {dayEvents.map((e, j) => (
                            <Link
                              key={j}
                              to={e.to}
                              title={`${e.name}: ${e.what}`}
                              className={cx('block truncate rounded-[3px] px-1 py-0.5 text-[0.65rem] ring-1 ring-inset ring-line-strong hover:ring-live md:px-1.5 md:text-xs', e.date >= today ? urgencyClass(e.date) : 'text-muted', e.done && 'line-through opacity-50')}
                            >
                              {e.name}
                            </Link>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className={cx(phoneView === 'month' && 'hidden md:block')}>
          {upcomingItems.length === 0 ? (
            <Section title="Upcoming">
              <p className="py-3 text-sm text-muted">No upcoming deadlines for anything you're applying to.</p>
            </Section>
          ) : (
            <div className="space-y-8">
              {Object.entries(byMonth).map(([k, list]) => (
                <Section key={k} title={new Date(k + '-01T00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })} count={list.length}>
                  <ul className="divide-y divide-line">
                    {list.map((e, i) => (
                      <li key={i}>
                        <Row
                          to={e.to}
                          lead={
                            <div>
                              <div className={cx('num text-sm font-medium', urgencyClass(e.date))}>{countdown(e.date)}</div>
                              <div className="num text-xs text-muted">{shortDate(e.date)}</div>
                            </div>
                          }
                          title={e.name}
                          meta={e.what}
                          trail={e.tag === 'scholarship' ? <Tag family="kind" value="scholarship" /> : e.tag === 'test' ? <Tag tone="teal">Test</Tag> : e.tag === 'expiry' ? <Tag tone="orange">Expiry</Tag> : undefined}
                        />
                      </li>
                    ))}
                  </ul>
                </Section>
              ))}
            </div>
          )}
        </div>
      </div>
    </ApplyPage>
  )
}
