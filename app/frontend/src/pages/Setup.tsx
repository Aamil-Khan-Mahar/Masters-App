import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useData } from '../data'
import { cx } from '../lib'
import { Button } from '../components/ui'

/** Shown instead of the app until the data folder exists. Creates it, then hands over to the profile. */
export function SetupGate({ children }: { children: ReactNode }) {
  const { meta, loading, error } = useData()
  if (loading) return null
  if (error && !meta) {
    return (
      <Shell>
        <h1 className="font-display text-[2rem]">Can't reach the app's server.</h1>
        <p className="mt-3 text-sm text-muted">{error}. Start it with <code className="font-mono text-xs">python app/start.py</code> and reload this page.</p>
      </Shell>
    )
  }
  if (meta && !meta.setup.ready) return <Setup />
  return <>{children}</>
}

function Shell({ children }: { children: ReactNode }) {
  return <main className="mx-auto max-w-[44rem] px-4 pt-16 pb-24 md:pt-24">{children}</main>
}

function Choice({ selected, onClick, title, children }: { selected: boolean; onClick: () => void; title: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx('block w-full rounded-md px-4 py-3 text-left ring-1 transition-colors', selected ? 'ring-live bg-live/5' : 'ring-line hover:ring-line-strong')}
    >
      <div className="text-sm font-medium text-text">{title}</div>
      <div className="mt-0.5 text-sm text-muted">{children}</div>
    </button>
  )
}

export default function Setup() {
  const { meta, refresh } = useData()
  const navigate = useNavigate()
  const [example, setExample] = useState(false)
  const [git, setGit] = useState(true)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  if (!meta) return null
  const { setup } = meta

  const create = async () => {
    setBusy(true)
    setFailed(null)
    try {
      await api.setup(example, git)
      await refresh()
      navigate('/you/profile')
    } catch (e) {
      // Toasts live in the page layouts, which aren't on screen yet.
      setFailed((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell>
      <div className="text-sm text-muted">First run</div>
      <h1 className="mt-2 font-display text-[2.4rem] leading-[1.02] md:text-[3rem]">Where your applications will live.</h1>
      <p className="mt-4 max-w-[60ch] text-base text-muted">
        Everything you add (profile, resumes, transcript, test scores, recommenders, every program and essay) is saved as plain files in one folder on this computer:
      </p>
      <p className="mt-3 rounded-md bg-panel-2 px-4 py-3 font-mono text-xs break-all text-text">{setup.data_root}</p>

      {setup.exposed ? (
        <div className="mt-4 rounded-md border border-danger/50 px-4 py-3 text-sm">
          This folder is inside the app's git repo and isn't ignored, so committing the app would share your data. Remove <code className="font-mono text-xs">DATA_ROOT</code> from <code className="font-mono text-xs">app/.env</code> to use the default <code className="font-mono text-xs">data/</code> folder, or point it outside the repo, then restart the app.
        </div>
      ) : (
        <p className="mt-4 max-w-[60ch] text-sm text-muted">
          The app's code and your data never mix: the app's git repo ignores this folder, so you can share or update the app without sharing anything about you. Nothing here leaves this computer except what an AI feature sends to Claude while it works.
        </p>
      )}

      <div className="mt-10 space-y-3">
        <Choice selected={!example} onClick={() => setExample(false)} title="Start empty">
          Fill in your profile next, then add programs from Discover.
        </Choice>
        {setup.sample_available && (
          <Choice selected={example} onClick={() => setExample(true)} title="Start with example data">
            One made-up program, scholarship and recommender to click around with. Delete them whenever you like.
          </Choice>
        )}
      </div>

      <label className="mt-6 flex cursor-pointer items-start gap-3 text-sm">
        <input type="checkbox" checked={git} onChange={(e) => setGit(e.target.checked)} className="mt-1 accent-[var(--color-live)]" disabled={setup.git} />
        <span>
          <span className="text-text">{setup.git ? 'Already its own git repo' : 'Make it its own private git repo'}</span>
          <span className="block text-muted">Separate from the app's repo, so you can back it up to a private remote. Passwords go in its Private/ folder, which it ignores.</span>
        </span>
      </label>

      <Button variant="primary" className="mt-10" loading={busy} disabled={!!setup.exposed} onClick={create}>
        Create my data folder
      </Button>
      {failed && <p className="mt-4 text-sm text-danger">{failed}</p>}
    </Shell>
  )
}
