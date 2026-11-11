import type { ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useData } from '../data'
import { cx } from '../lib'
import { Toasts } from './Layout'
import ModeSwitch from './ModeSwitch'

// Apply mode: the calm side of the app. A slim top bar, five places, nothing about research.
const SECTIONS = [
  { to: '/apply/next', label: 'Up next' },
  { to: '/apply', label: 'Applications', exact: true },
  { to: '/apply/letters', label: 'Letters' },
  { to: '/apply/calendar', label: 'Calendar' },
  { to: '/apply/outcomes', label: 'Outcomes' },
]

export default function ApplyLayout() {
  const { profile } = useData()
  const { pathname } = useLocation()
  const on = (s: (typeof SECTIONS)[number]) => (s.exact ? pathname === s.to : pathname.startsWith(s.to))
  return (
    <div className="flex h-full flex-col">
      <header className="pt-safe shrink-0 border-b border-line">
        <div className="flex h-12 items-center gap-6 px-4 lg:px-5">
          <Link to="/apply/next" className="hidden shrink-0 font-display text-lg leading-none sm:block">
            {profile?.target_intake ? `${profile.target_intake} applications` : 'Applications'}
          </Link>
          <nav className="hidden h-full items-stretch gap-5 md:flex" aria-label="Apply">
            {SECTIONS.map((s) => (
              <NavLink key={s.to} to={s.to} end={s.exact} className={cx('flex items-center border-b-2 text-sm', on(s) ? 'border-live text-text' : 'border-transparent text-muted hover:text-text')}>
                {s.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-4">
            <YouLink />
            <ModeSwitch />
          </div>
        </div>
      </header>

      <div className="mb-tabbar min-h-0 flex-1 md:mb-0">
        <Outlet />
      </div>

      {/* phone: the five places along the bottom */}
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/95 backdrop-blur md:hidden" aria-label="Apply">
        <div className="grid h-16 grid-cols-5">
          {SECTIONS.map((s) => (
            <NavLink key={s.to} to={s.to} end={s.exact} className={cx('flex items-center justify-center text-[0.72rem]', on(s) ? 'font-medium text-text' : 'text-muted')}>
              <span className={cx('border-b-2 pb-1', on(s) ? 'border-live' : 'border-transparent')}>{s.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
      <Toasts />
    </div>
  )
}

/** The shared "You" area (profile, tests, files), reachable from both modes. */
export function YouLink({ className }: { className?: string }) {
  const { profile } = useData()
  const { pathname } = useLocation()
  const initials = (profile?.name ?? 'You').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  return (
    <Link
      to="/you"
      state={{ from: pathname }}
      title="You: profile, tests and files"
      className={cx('grid h-7 w-7 shrink-0 place-items-center rounded-full bg-panel-2 text-[0.65rem] font-semibold ring-1 ring-line-strong hover:ring-live', pathname.startsWith('/you') && 'ring-live', className)}
    >
      {initials}
    </Link>
  )
}

/** A normal scrolling page inside Apply (Up next, Letters, Calendar, Outcomes). */
export function ApplyPage({ children }: { children: ReactNode }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="page-in mx-auto w-full max-w-[2200px] px-4 pt-5 pb-16 md:px-10 md:pt-10 3xl:px-16">{children}</div>
    </div>
  )
}
