import { Link, useLocation } from 'react-router-dom'
import { cx } from '../lib'

/** Research (find, compare, shortlist) or Apply (the calm workspace for programs you're preparing). */
export default function ModeSwitch({ className }: { className?: string }) {
  const apply = useLocation().pathname.startsWith('/apply')
  const item = (on: boolean) => cx('flex-1 rounded-[5px] px-3 py-1 text-center text-xs font-medium transition-colors', on ? 'bg-panel-2 text-text ring-1 ring-line-strong' : 'text-muted hover:text-text')
  return (
    <div className={cx('inline-flex rounded-md bg-panel p-0.5 ring-1 ring-line', className)} role="tablist" aria-label="Mode">
      <Link to="/" role="tab" aria-selected={!apply} className={item(!apply)}>
        Research
      </Link>
      <Link to="/apply" role="tab" aria-selected={apply} className={item(apply)}>
        Apply
      </Link>
    </div>
  )
}
