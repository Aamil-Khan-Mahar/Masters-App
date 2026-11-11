import { useData } from '../data'
import { cx } from '../lib'

/** "Use Opus" switch shown wherever agents are sent out. One shared, session-only choice. */
export default function OpusToggle({ className }: { className?: string }) {
  const { strong, setStrong, meta } = useData()
  if (!meta?.ai_configured) return null
  return (
    <button
      type="button"
      role="switch"
      aria-checked={strong}
      onClick={() => setStrong(!strong)}
      title={strong ? `New agents run on ${meta.model_strong}: deeper, but uses more of your plan` : `New agents run on ${meta.model}. Switch on to send them on ${meta.model_strong}`}
      className={cx(
        'inline-flex h-7 items-center gap-2 rounded-lg px-2.5 text-xs whitespace-nowrap ring-1 transition-colors',
        strong ? 'bg-accent/10 text-accent ring-accent/40' : 'text-muted ring-line hover:text-text hover:ring-line-strong',
        className,
      )}
    >
      <span className={cx('relative h-3.5 w-6 rounded-full transition-colors', strong ? 'bg-accent' : 'bg-line-strong')}>
        <span className={cx('absolute top-0.5 h-2.5 w-2.5 rounded-full bg-bg transition-[left]', strong ? 'left-3' : 'left-0.5')} />
      </span>
      Use Opus
    </button>
  )
}
