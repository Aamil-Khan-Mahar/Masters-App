import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { cx } from '../lib'
import { Toasts } from './Layout'
import ModeSwitch from './ModeSwitch'

// "You": what describes the applicant rather than any program. Shared by both modes, so it has its own small shell
// and a way back to whichever mode you came from.
const TABS = [
  { to: '/you/profile', label: 'Profile' },
  { to: '/you/tests', label: 'Tests' },
  { to: '/you/courses', label: 'Courses' },
  { to: '/you/files', label: 'Files' },
]
const KEY = 'you-from'

export default function YouLayout() {
  const { pathname, state } = useLocation()
  const [from, setFrom] = useState(() => {
    try {
      return sessionStorage.getItem(KEY) ?? '/'
    } catch {
      return '/'
    }
  })
  useEffect(() => {
    const f = (state as { from?: string } | null)?.from
    if (f && !f.startsWith('/you')) {
      setFrom(f)
      try {
        sessionStorage.setItem(KEY, f)
      } catch {
        /* private mode */
      }
    }
  }, [state])
  const backTo = from.startsWith('/apply') ? 'Apply' : 'Research'

  return (
    <div className="flex h-full flex-col">
      <header className="pt-safe shrink-0 border-b border-line">
        <div className="flex h-12 items-center gap-6 px-4 lg:px-5">
          <Link to={from} className="flex shrink-0 items-center gap-1 text-sm text-muted hover:text-text">
            <span aria-hidden className="text-lg leading-none">‹</span> {backTo}
          </Link>
          <nav className="flex h-full items-stretch gap-5" aria-label="You">
            {TABS.map((t) => (
              <NavLink key={t.to} to={t.to} className={cx('flex items-center border-b-2 text-sm', pathname.startsWith(t.to) ? 'border-live text-text' : 'border-transparent text-muted hover:text-text')}>
                {t.label}
              </NavLink>
            ))}
          </nav>
          <ModeSwitch className="ml-auto hidden sm:inline-flex" />
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div key={pathname} className="page-in pb-safe mx-auto w-full max-w-[2200px] px-4 pt-5 pb-16 md:px-10 md:pt-10 3xl:px-16">
          <Outlet />
        </div>
      </div>
      <Toasts />
    </div>
  )
}
