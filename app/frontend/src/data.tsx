import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, isActive, waitForJob, type Application, type Job, type Meta, type Profile, type Recommender } from './api'

interface DataState {
  apps: Application[]
  recommenders: Recommender[]
  profile: Profile | null
  meta: Meta | null
  loading: boolean
  error: string | null
  jobs: Job[]
  refresh: () => Promise<void>
  update: (id: string, patch: Partial<Application>) => Promise<Application>
  setProfile: (p: Profile) => void
  setRecommenders: (r: Recommender[]) => void
  replaceApp: (a: Application) => void
  removeApp: (id: string) => void
  /** Start an AI job, track it globally, and resolve with the finished job. `start` gets the "Use Opus" choice. */
  runJob: <T>(start: (strong: boolean) => Promise<Job<T>>) => Promise<Job<T>>
  /** Send a research team (profile, funding, faculty, then scoring) to one application. */
  runMission: (appId: string, opts?: { force?: boolean }) => Promise<Job[]>
  /** Start several independent agents at once (e.g. one per faculty member) and track each. */
  runBatch: (start: (strong: boolean) => Promise<{ agents: Job[] }>, what: string) => Promise<Job[]>
  cancelJob: (id: string) => Promise<void>
  /** The waiting or working job of this kind (optionally for one application), if any. */
  runningJob: (kind: string, appId?: string) => Job | undefined
  /** Any waiting or working job for this application. */
  busyApp: (appId: string) => Job | undefined
  /** Run new agents on the stronger model (Opus). Session only, so it never sticks on by accident. */
  strong: boolean
  setStrong: (v: boolean) => void
  toast: (msg: string, tone?: 'ok' | 'error') => void
  toasts: { id: number; msg: string; tone: 'ok' | 'error' }[]
}

const Ctx = createContext<DataState | null>(null)

export function DataProvider({ children }: { children: ReactNode }) {
  const [apps, setApps] = useState<Application[]>([])
  const [recommenders, setRecommenders] = useState<Recommender[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [strong, setStrong] = useState(false)
  const [toasts, setToasts] = useState<{ id: number; msg: string; tone: 'ok' | 'error' }[]>([])

  const toast = useCallback((msg: string, tone: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, msg, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 7000 : 3500)
  }, [])

  const refresh = useCallback(async () => {
    try {
      const [a, r, p, m] = await Promise.all([api.applications(), api.recommenders(), api.profile(), api.meta()])
      setApps(a)
      setRecommenders(r)
      setProfile(p)
      setMeta(m)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const replaceApp = useCallback((a: Application) => {
    setApps((list) => (list.some((x) => x.id === a.id) ? list.map((x) => (x.id === a.id ? a : x)) : [...list, a]))
  }, [])

  const removeApp = useCallback((id: string) => setApps((list) => list.filter((x) => x.id !== id)), [])

  const update = useCallback(
    async (id: string, patch: Partial<Application>) => {
      // The stage drives archiving (the server does the same): Not considering archives it, any other stage brings it
      // back, and archive / unarchive on their own move it to Not considering or back to the stage it was at.
      // (Unarchiving on its own is settled by the server's reply, which restores the remembered stage.)
      if (patch.stage) patch = { ...patch, archived: patch.stage === 'dropped' }
      else if (patch.archived === true) patch = { ...patch, stage: 'dropped' }
      // Optimistic: reflect the change immediately, then reconcile with the server's copy.
      setApps((list) => list.map((x) => (x.id === id ? { ...x, ...patch } : x)))
      try {
        const saved = await api.update(id, patch)
        replaceApp(saved)
        return saved
      } catch (e) {
        toast(`Save failed: ${(e as Error).message}`, 'error')
        refresh()
        throw e
      }
    },
    [replaceApp, refresh, toast],
  )

  const upsertJob = useCallback((u: Job) => setJobs((list) => (list.some((x) => x.id === u.id) ? list.map((x) => (x.id === u.id ? u : x)) : [u, ...list])), [])

  /** Poll a job to completion at the app level, so it keeps going whichever page is open. */
  const track = useCallback(
    async <T,>(job: Job<T>, quiet = false) => {
      const done = await waitForJob<T>(job.id, (u) => upsertJob(u as Job))
      // Research, funding, faculty and scoring return the updated application; apply it wherever the user is now.
      const result = done.result as unknown as Application | undefined
      if (done.status === 'done' && ['research', 'score', 'faculty', 'faculty-member', 'faculty-deep', 'funding', 'ask', 'resume', 'resume-edit', 'course-check', 'requirements'].includes(done.kind) && result?.id) replaceApp(result)
      // The tests agent returns the saved profile with the updated test list.
      if (done.status === 'done' && done.kind === 'tests' && done.result) setProfile(done.result as unknown as Profile)
      if (done.status === 'error') toast(`${done.agent}: ${done.error ?? 'AI job failed'}`, 'error')
      else if (done.status === 'cancelled') !quiet && toast(`${done.agent} stood down: ${done.label}`)
      else if (!quiet) toast(`${done.agent} finished ${done.kind === 'discover' ? 'the search' : done.label}${done.usage?.backend === 'api' ? ` ($${done.usage.cost_usd.toFixed(3)})` : ''}`)
      if (done.status === 'done') api.meta().then(setMeta)
      return done
    },
    [toast, replaceApp, upsertJob],
  )

  const runJob = useCallback(
    async <T,>(start: (strong: boolean) => Promise<Job<T>>) => {
      let job: Job<T>
      try {
        job = await start(strong)
      } catch (e) {
        toast((e as Error).message, 'error')
        throw e
      }
      upsertJob(job as Job)
      return track(job)
    },
    [toast, track, upsertJob, strong],
  )

  const runMission = useCallback(
    async (appId: string, opts: { force?: boolean } = {}) => {
      let res
      try {
        res = await api.mission(appId, strong, !!opts.force)
      } catch (e) {
        toast((e as Error).message, 'error')
        throw e
      }
      if (!res.agents.length) {
        toast(`Everything here was researched in the last 30 days, so no one was sent. Use "Research again" to force it.`)
        return []
      }
      res.agents.forEach((a) => upsertJob(a as Job))
      toast(`Sent ${res.agents.map((a) => a.agent).join(', ')}${res.skipped.length ? `. Skipped ${res.skipped.join(', ')}, researched recently` : ''}`)
      const done = await Promise.all(res.agents.map((a) => track(a as Job, true)))
      const ok = done.filter((d) => d.status === 'done').length
      if (ok) toast(`${res.mission.label}: ${ok} of ${done.length} agents reported back`)
      return done
    },
    [strong, toast, track, upsertJob],
  )

  const runBatch = useCallback(
    async (start: (strong: boolean) => Promise<{ agents: Job[] }>, what: string) => {
      let res
      try {
        res = await start(strong)
      } catch (e) {
        toast((e as Error).message, 'error')
        throw e
      }
      if (!res.agents.length) {
        toast(`Nothing left to research: ${what}`)
        return []
      }
      res.agents.forEach((a) => upsertJob(a))
      toast(`Sent ${res.agents.length} agent${res.agents.length === 1 ? '' : 's'}: ${what}. They take turns, a few at a time.`)
      const done = await Promise.all(res.agents.map((a) => track(a, true)))
      toast(`${what}: ${done.filter((d) => d.status === 'done').length} of ${done.length} done`)
      return done
    },
    [strong, toast, track, upsertJob],
  )

  const cancelJob = useCallback(
    async (id: string) => {
      try {
        upsertJob(await api.cancelJob(id))
      } catch (e) {
        toast((e as Error).message, 'error')
      }
    },
    [toast, upsertJob],
  )

  // After a reload, pick up jobs the server is still running (and recent results).
  useEffect(() => {
    api
      .jobs()
      .then((serverJobs) => {
        setJobs(serverJobs)
        serverJobs.filter(isActive).forEach((j) => track(j, true))
      })
      .catch(() => undefined)
  }, [track])

  const runningJob = useCallback(
    (kind: string, appId?: string) => jobs.find((j) => isActive(j) && j.kind === kind && (!appId || j.params?.app_id === appId)),
    [jobs],
  )
  const busyApp = useCallback((appId: string) => jobs.find((j) => isActive(j) && j.params?.app_id === appId), [jobs])

  const value = useMemo(
    () => ({ apps, recommenders, profile, meta, loading, error, jobs, refresh, update, setProfile, setRecommenders, replaceApp, removeApp, runJob, runMission, runBatch, cancelJob, runningJob, busyApp, strong, setStrong, toast, toasts }),
    [apps, recommenders, profile, meta, loading, error, jobs, refresh, update, replaceApp, removeApp, runJob, runMission, runBatch, cancelJob, runningJob, busyApp, strong, toast, toasts],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useData() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useData outside DataProvider')
  return v
}
