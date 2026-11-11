import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { isActive } from '../api'
import { useData } from '../data'
import { allDeadlines, countdown, cx, shortName, urgencyClass } from '../lib'
import { Spinner } from './ui'
import ModeSwitch from './ModeSwitch'
import { YouLink } from './ApplyLayout'
import { inApply } from '../applyTasks'

type Item = { to: string; label: string; icon: string }
const I = {
  today: 'M4 5h16v15H4zM4 9h16M8 3v4M16 3v4M8 13h3v3H8z',
  apps: 'M4 5h7v6H4zM13 5h7v6h-7zM4 13h7v6H4zM13 13h7v6h-7z',
  scholar: 'M12 3L2 8l10 5 10-5-10-5zM6 10.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-5.5',
  discover: 'M11 4a7 7 0 100 14 7 7 0 000-14zm9 16l-4.3-4.3',
  money: 'M3 7h18v10H3zM12 9.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM6 10v4M18 10v4',
  town: 'M3 21h18M5 21V11l4-3 4 3v10M13 21v-7l3-2 3 2v7M8 21v-4h2v4',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  check: 'M5 5h14v14H5zM8.5 12l2.5 2.5 4.5-5',
}

export const NAV: { group: string; items: Item[] }[] = [
  { group: 'Research', items: [{ to: '/', label: 'Desk', icon: I.today }, { to: '/discover', label: 'Discover', icon: I.discover }] },
  {
    group: 'Your list',
    items: [
      { to: '/applications', label: 'Applications', icon: I.apps },
      { to: '/scholarships', label: 'Scholarships', icon: I.scholar },
      { to: '/requirements', label: 'Entry requirements', icon: I.check },
    ],
  },
  { group: 'Money', items: [{ to: '/money', label: 'Costs', icon: I.money }] },
  { group: 'Agents', items: [{ to: '/town', label: 'Agent Town', icon: I.town }] },
]

// Phone tab bar: the four places you go most, everything else under More.
const TABS: Item[] = [
  { to: '/', label: 'Desk', icon: I.today },
  { to: '/applications', label: 'Applications', icon: I.apps },
  { to: '/discover', label: 'Discover', icon: I.discover },
  { to: '/money', label: 'Costs', icon: I.money },
]

function Icon({ d, className = 'h-[18px] w-[18px]' }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cx('shrink-0', className)} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  )
}

const isOn = (pathname: string, to: string) => (to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(to + '/'))

export default function Layout() {
  const { meta, jobs, profile, apps } = useData()
  const { pathname } = useLocation()
  const running = jobs.filter(isActive)
  const next = allDeadlines(apps.filter((a) => !inApply(a) && a.stage !== 'final'), false, true)[0]
  const [moreOpen, setMoreOpen] = useState(false)
  useEffect(() => setMoreOpen(false), [pathname])
  // Program pages live under /app/... but belong to Applications in the nav.
  const navPath = pathname.startsWith('/app/') ? '/applications' : pathname
  const season = profile?.target_intake ? `${profile.target_intake} applications` : 'Applications'

  return (
    <div className="flex h-full">
      {/* ---------------------------------------------------------------- desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-bg md:flex 3xl:w-64">
        <Link to="/" className="block px-6 pt-8 pb-8">
          <div className="font-display text-[1.6rem] leading-[1.05]">{season}</div>
          {profile?.name && <div className="mt-1.5 truncate text-xs text-muted">{profile.name}</div>}
        </Link>
        <div className="mx-6 mb-6 flex items-center gap-3">
          <ModeSwitch className="flex-1" />
          <YouLink />
        </div>

        <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-4" aria-label="Main">
          {NAV.map((g) => (
            <div key={g.group}>
              <div className="mb-1 px-3 text-xs text-muted/70">{g.group}</div>
              <div className="space-y-px">
                {g.items.map((n) => (
                  <NavLink
                    key={n.to}
                    to={n.to}
                    className={cx(
                      'relative flex items-center gap-3 rounded-md px-3 py-2 text-sm',
                      isOn(navPath, n.to) ? 'bg-panel-2 font-medium text-text before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-live' : 'text-muted hover:bg-panel hover:text-text',
                    )}
                  >
                    <Icon d={n.icon} />
                    {n.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="space-y-3 border-t border-line px-6 py-5 text-xs text-muted">
          {next && (
            <Link to={`/app/${next.app.id}`} className="block hover:text-text">
              <div className="text-muted/70">Next deadline</div>
              <div className="mt-0.5 flex items-baseline justify-between gap-2">
                <span className="truncate text-text">{shortName(next.app)}</span>
                <span className={cx('num shrink-0', urgencyClass(next.date))}>{countdown(next.date)}</span>
              </div>
            </Link>
          )}
          {running.length > 0 && (
            <NavLink to="/town" className="block space-y-1.5 hover:text-text">
              {running.slice(0, 4).map((j) => (
                <div key={j.id} className={cx('flex items-center gap-2', j.status === 'working' ? 'text-live' : 'text-muted')} title={j.activity?.[j.activity.length - 1]?.text}>
                  {j.status === 'working' ? <Spinner /> : <span className="grid h-3.5 w-3.5 place-items-center"><span className="h-1.5 w-1.5 rounded-full bg-muted/60" /></span>}
                  <span className="truncate">
                    {j.agent}: {j.label}
                  </span>
                </div>
              ))}
              {running.length > 4 && <div className="pl-5.5">+{running.length - 4} more in Agent Town</div>}
            </NavLink>
          )}
          <div className="flex items-center gap-2" title={meta?.model}>
            <span className={cx('h-1.5 w-1.5 rounded-full', meta?.ai_configured ? 'bg-live' : 'bg-danger')} />
            {meta?.ai_configured ? <span className="truncate">{meta.ai_backend === 'claude-code' ? 'Claude subscription' : 'Claude API'}</span> : <span className="text-danger">AI off</span>}
          </div>
          {meta && (meta.ai_backend === 'api' || meta.ai_spend_usd > 0) && <div className="num">API spend ${meta.ai_spend_usd.toFixed(2)}</div>}
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
        {/* ---------------------------------------------------------------- phone top bar */}
        <div className="pt-safe sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur md:hidden">
          <div className="flex h-12 items-center gap-3 px-4">
            <Link to="/" className="truncate font-display text-lg leading-none">
              {season}
            </Link>
            {running.length > 0 && (
              <NavLink to="/town" className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-live">
                <Spinner /> {running.length}
              </NavLink>
            )}
            <YouLink className={running.length ? undefined : 'ml-auto'} />
            <ModeSwitch className="shrink-0" />
          </div>
        </div>

        <div key={pathname} className="page-in mb-tabbar mx-auto w-full max-w-[2200px] px-4 pt-5 pb-10 md:mb-0 md:px-10 md:pt-10 md:pb-16 3xl:px-16">
          <Outlet />
        </div>
      </main>

      {/* ---------------------------------------------------------------- phone tab bar */}
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/95 backdrop-blur md:hidden" aria-label="Main">
        <div className="grid h-16 grid-cols-5">
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} className={cx('flex flex-col items-center justify-center gap-1 text-[0.68rem]', isOn(navPath, t.to) ? 'text-text' : 'text-muted')}>
              <Icon d={t.icon} className={cx('h-[22px] w-[22px]', isOn(navPath, t.to) && 'text-live')} />
              {t.label}
            </NavLink>
          ))}
          <button onClick={() => setMoreOpen(true)} className={cx('flex flex-col items-center justify-center gap-1 text-[0.68rem]', moreOpen ? 'text-text' : 'text-muted')}>
            <Icon d={I.more} className="h-[22px] w-[22px]" />
            More
          </button>
        </div>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-40 flex items-end bg-black/75 md:hidden" onClick={() => setMoreOpen(false)}>
          <div className="page-in pb-safe w-full rounded-t-xl border-t border-line-strong bg-panel" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line-strong" aria-hidden />
            <div className="grid grid-cols-3 gap-1 p-3 pb-5">
              {NAV.flatMap((g) => g.items)
                .filter((n) => !TABS.some((t) => t.to === n.to))
                .map((n) => (
                  <NavLink key={n.to} to={n.to} className={cx('flex flex-col items-center gap-2 rounded-lg px-2 py-4 text-xs', isOn(navPath, n.to) ? 'bg-panel-2 text-text' : 'text-muted')}>
                    <Icon d={n.icon} className={cx('h-6 w-6', isOn(navPath, n.to) && 'text-live')} />
                    {n.label}
                  </NavLink>
                ))}
            </div>
          </div>
        </div>
      )}

      <Toasts />
    </div>
  )
}

/** Saved/failed messages, shared by both modes. */
export function Toasts() {
  const { toasts } = useData()
  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-50 flex flex-col gap-2 sm:left-auto sm:w-96 md:right-6 md:bottom-6" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cx('page-in pointer-events-auto rounded-lg border px-4 py-3 text-sm shadow-xl shadow-black/60', t.tone === 'error' ? 'border-danger/50 bg-[#1f0b0a] text-text' : 'border-line-strong bg-panel-2 text-text')}>
          {t.msg}
        </div>
      ))}
    </div>
  )
}
