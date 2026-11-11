import { useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Stage } from '../api'
import { Link } from 'react-router-dom'
import { cx, DOT, STAGES, stageInfo, tagTone, TONE, type Tone } from '../lib'

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-8 gap-y-4 md:mb-10">
      <div className="min-w-0">
        <h1 className="font-display text-[2rem] leading-[1.05] font-normal text-text md:text-[2.6rem] 3xl:text-[3rem]">{title}</h1>
        {subtitle && <div className="mt-2 max-w-[72ch] text-sm leading-relaxed text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Card({ children, className, title, actions, flush }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode; flush?: boolean }) {
  return (
    <section className={cx('border-t border-line-strong', className)}>
      {(title || actions) && (
        <header className="flex min-h-11 items-baseline justify-between gap-3 pt-3 pb-2">
          <h2 className="font-display text-[1.15rem] leading-snug text-text">{title}</h2>
          {actions && <div className="flex items-center gap-2 text-xs">{actions}</div>}
        </header>
      )}
      <div className={flush ? '' : 'pt-2 pb-1'}>{children}</div>
    </section>
  )
}

/** Small section heading inside a page (not a card). */
export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="font-display text-lg font-medium">{children}</h2>
      {aside && <div className="text-xs text-muted">{aside}</div>}
    </div>
  )
}

type Variant = 'primary' | 'ghost' | 'subtle' | 'danger'
export function Button({ variant = 'subtle', size = 'md', className, loading, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean }) {
  const styles: Record<Variant, string> = {
    primary: 'bg-accent text-black hover:bg-[#ffe04d] font-semibold disabled:bg-panel-2 disabled:text-muted disabled:opacity-100',
    subtle: 'bg-panel-2 text-text ring-1 ring-line hover:ring-line-strong hover:bg-[#1f1f1f]',
    ghost: 'text-muted hover:text-text hover:bg-panel-2',
    danger: 'text-danger ring-1 ring-danger/30 hover:bg-danger/10',
  }
  return (
    <button
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
        styles[variant],
        className,
      )}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx('inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent', className)} aria-hidden />
}

const field =
  'w-full rounded-md border border-line-strong bg-bg px-3 py-2 text-sm text-text placeholder:text-muted/50 outline-none transition-colors hover:border-line-strong focus:border-live/70 focus:ring-2 focus:ring-live/20'

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(field, className)} {...rest} />
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(field, 'leading-relaxed', className)} {...rest} />
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(field, 'cursor-pointer', className)} {...rest}>
      {children}
    </select>
  )
}

/** Text input that keeps local state while typing and commits on blur / Enter. */
export function EditableText({ value, onSave, placeholder, multiline, className, type = 'text' }: { value: string | number | null | undefined; onSave: (v: string) => void; placeholder?: string; multiline?: boolean; className?: string; type?: string }) {
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => setDraft(value ?? ''), [value])
  const commit = () => {
    if (String(draft) !== String(value ?? '')) onSave(String(draft))
  }
  if (multiline)
    return <Textarea className={className} value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onBlur={commit} rows={4} />
  return (
    <Input
      className={className}
      type={type}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}

export function Label({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2 text-xs font-medium text-muted">
      <span>{children}</span>
      {hint && <span className="font-normal text-muted/70">{hint}</span>}
    </div>
  )
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center gap-1.5 rounded-[3px] px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset', className ?? 'bg-panel-2 text-muted ring-line')}>{children}</span>
}

/** Where an application sits in the season: one dot per stage, filled up to the current one. */
export function StageTrack({ stage, className }: { stage: Stage; className?: string }) {
  // Not considering sits outside the season, so it has no place on the track.
  const track = STAGES.filter((x) => x.id !== 'dropped')
  if (stage === 'dropped') return null
  const at = track.findIndex((x) => x.id === stage)
  return (
    <span className={cx('inline-flex items-center gap-[3px]', className)} aria-hidden>
      {track.map((x, i) => (
        <span key={x.id} className={cx('h-[5px] w-[5px] rounded-full', i < at ? 'bg-white/70' : i === at ? (at === 0 ? 'bg-muted' : 'bg-white') : 'ring-1 ring-inset ring-line-strong')} />
      ))}
    </span>
  )
}

export function StageBadge({ stage, track }: { stage: Stage; track?: boolean }) {
  const s = stageInfo(stage)
  return (
    <span className="inline-flex items-center gap-2" title={`Stage: ${s.label}`}>
      {track && <StageTrack stage={stage} />}
      <Tag tone={tagTone('stage', stage)}>{s.label}</Tag>
    </span>
  )
}

export function TierBadge({ tier }: { tier?: string }) {
  if (!tier) return null
  return <Tag tone={tagTone('tier', tier)}>{tier[0].toUpperCase() + tier.slice(1)}</Tag>
}

/** A coloured tag. Pass a tone directly, or a family + value from TAGS (lib.ts). */
export function Tag({ tone, family, value, dot, children, className, title }: { tone?: Tone; family?: string; value?: string | null; dot?: boolean; children?: ReactNode; className?: string; title?: string }) {
  const t = tone ?? tagTone(family ?? '', value)
  const label = children ?? (value ? value.charAt(0).toUpperCase() + value.slice(1) : '')
  return (
    <span title={title} className={cx('inline-flex items-center gap-1.5 rounded-[4px] px-1.5 py-[3px] text-xs leading-none font-medium whitespace-nowrap ring-1 ring-inset', TONE[t], className)}>
      {dot && <span className={cx('h-1.5 w-1.5 rounded-full', DOT[t])} />}
      {label}
    </span>
  )
}

export const Chevron = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 16 16" className={cx('h-4 w-4 shrink-0', className)} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M6 3.5L10.5 8 6 12.5" />
  </svg>
)
const ExternalIcon = () => (
  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M6 3.5H3.5v9h9V10M9 3h4v4M13 3L7.5 8.5" />
  </svg>
)

/** "Open" affordance for anything with its own page. */
export function OpenLink({ to, children = 'Open', className }: { to: string; children?: ReactNode; className?: string }) {
  return (
    <Link to={to} className={cx('inline-flex items-center gap-0.5 text-sm whitespace-nowrap text-live hover:underline', className)}>
      {children}
      <Chevron />
    </Link>
  )
}

/** Link that leaves the app (official pages, portals, emails). */
export function ExternalLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={cx('inline-flex min-w-0 items-center gap-1 text-live hover:underline', className)}>
      <span className="truncate">{children}</span>
      <ExternalIcon />
    </a>
  )
}

/**
 * One list row that always opens something: the whole row is the link and ends in a chevron.
 * lead: left column (date, score), title/meta: the text, tags: tags before the trail, trail: right-most value.
 */
export function Row({ to, lead, title, meta, tags, trail, className }: { to: string; lead?: ReactNode; title: ReactNode; meta?: ReactNode; tags?: ReactNode; trail?: ReactNode; className?: string }) {
  return (
    <Link to={to} className={cx('group flex items-center gap-4 py-3.5 pr-1 md:gap-5', className)}>
      {lead && <div className="w-16 shrink-0 md:w-20">{lead}</div>}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[0.95rem] text-text group-hover:text-live">{title}</div>
        {meta && <div className="mt-0.5 truncate text-sm text-muted">{meta}</div>}
      </div>
      {tags && <div className="hidden shrink-0 items-center gap-1.5 sm:flex">{tags}</div>}
      {trail && <div className="shrink-0 text-right">{trail}</div>}
      <span className="text-muted group-hover:text-live">
        <Chevron />
      </span>
    </Link>
  )
}

/** A titled block under a rule. `open` puts a "See all" style link on the right. */
export function Section({ title, count, open, aside, children, className }: { title: ReactNode; count?: number; open?: { to: string; label?: string }; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('border-t border-line-strong', className)}>
      <header className="flex items-baseline justify-between gap-4 pt-3.5 pb-2">
        <h2 className="font-display text-[1.25rem] leading-snug">
          {title}
          {count !== undefined && <span className="num ml-2 text-base text-muted">{count}</span>}
        </h2>
        <div className="flex items-center gap-4 text-sm">
          {aside}
          {open && <OpenLink to={open.to}>{open.label ?? 'See all'}</OpenLink>}
        </div>
      </header>
      {children}
    </section>
  )
}

/** Switch between views of the same list (cards / board / compare). */
export function ViewSwitch<T extends string>({ views, value, onChange }: { views: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-md p-0.5 ring-1 ring-line-strong" role="tablist">
      {views.map((v) => (
        <button
          key={v.id}
          role="tab"
          aria-selected={value === v.id}
          onClick={() => onChange(v.id)}
          className={cx('rounded-[4px] px-3.5 py-1.5 text-sm', value === v.id ? 'bg-white font-medium text-black' : 'text-muted hover:text-text')}
        >
          {v.label}
        </button>
      ))}
    </div>
  )
}


export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-dark">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: (p) => <a {...p} target="_blank" rel="noreferrer" /> }}>{children}</ReactMarkdown>
    </div>
  )
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-line-strong px-6 py-12 text-center">
      <p className="font-display text-lg">{title}</p>
      {children && <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/75 sm:items-start sm:p-4 sm:pt-[8vh]" onMouseDown={onClose}>
      <div role="dialog" aria-label={title} className={cx('page-in pb-safe max-h-[92dvh] w-full overflow-y-auto rounded-t-xl border border-line-strong bg-panel sm:max-h-none sm:rounded-xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')} onMouseDown={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
          <h2 className="min-w-0 font-display text-xl font-medium">{title}</h2>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-md text-xl leading-none text-muted hover:bg-panel-2 hover:text-text" aria-label="Close">
            ×
          </button>
        </header>
        <div className="p-5 sm:p-6">{children}</div>
      </div>
    </div>
  )
}

/** A figure with a caption: number first, plain-language label underneath. */
export function Stat({ label, value, hint, accent }: { label: string; value: ReactNode; hint?: ReactNode; accent?: string }) {
  return (
    <div className="px-5 py-4">
      <div className={cx('num font-display text-[2rem] leading-none', accent ?? 'text-text')}>{value}</div>
      <div className="mt-2 text-sm text-text/80">{label}</div>
      {hint && <div className="mt-0.5 truncate text-xs text-muted">{hint}</div>}
    </div>
  )
}

export function Progress({ value, max, className, tone = 'bg-white' }: { value: number; max: number; className?: string; tone?: string }) {
  const pct = max ? Math.round((value / max) * 100) : 0
  return (
    <div className={cx('h-1 w-full overflow-hidden rounded-full bg-line', className)} role="progressbar" aria-valuenow={value} aria-valuemax={max}>
      <div className={cx('h-full rounded-full transition-[width] duration-500', pct === 100 ? 'bg-white' : tone)} style={{ width: `${pct}%` }} />
    </div>
  )
}

/** 0–10 score as a short meter plus the number. */
export function ScoreMeter({ value }: { value?: number }) {
  if (typeof value !== 'number') return <span className="num text-muted">—</span>
  const tone = value >= 8 ? 'bg-white' : value >= 5 ? 'bg-white/60' : 'bg-white/30'
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-1 w-8 overflow-hidden rounded-full bg-line">
        <span className={cx('block h-full rounded-full', tone)} style={{ width: `${value * 10}%` }} />
      </span>
      <span className="num w-4 text-right text-sm">{value}</span>
    </span>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="mb-6 flex gap-5 overflow-x-auto border-b border-line" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cx('-mb-px border-b-2 py-2.5 text-sm whitespace-nowrap transition-colors', value === t.id ? 'border-live text-text' : 'border-transparent text-muted hover:text-text')}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

/** Segmented control for small filters. */
export function Segmented<T extends string>({ options, value, onChange }: { options: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-md bg-panel-2 p-0.5 ring-1 ring-line">
      {options.map((o) => (
        <button key={o.id} onClick={() => onChange(o.id)} className={cx('rounded-[4px] px-3 py-1.5 text-xs transition-colors', value === o.id ? 'bg-bg text-text ring-1 ring-line-strong' : 'text-muted hover:text-text')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Small dropdown for secondary actions. Items run their action and close the menu; `danger` items sit last, set apart. */
export function Menu({ label = 'More', items }: { label?: ReactNode; items: { label: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean; hint?: string }[] }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  const normal = items.filter((i) => !i.danger)
  const danger = items.filter((i) => i.danger)
  const render = (i: (typeof items)[number], k: number) => (
    <button
      key={k}
      role="menuitem"
      disabled={i.disabled}
      title={i.hint}
      onClick={() => {
        setOpen(false)
        i.onClick()
      }}
      className={cx('block w-full rounded-md px-3 py-2 text-left text-sm disabled:opacity-40', i.danger ? 'text-danger hover:bg-danger/10' : 'hover:bg-panel-2')}
    >
      {i.label}
    </button>
  )
  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <Button onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        {label}
      </Button>
      {open && (
        <div role="menu" className="page-in absolute right-0 z-30 mt-1.5 w-60 rounded-lg border border-line-strong bg-panel p-1.5 shadow-2xl shadow-black/70">
          {normal.map(render)}
          {danger.length > 0 && <div className="my-1.5 border-t border-line" />}
          {danger.map((i, k) => render(i, normal.length + k))}
        </div>
      )}
    </div>
  )
}
