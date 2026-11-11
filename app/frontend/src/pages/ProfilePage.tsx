import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Profile } from '../api'
import { useData } from '../data'
import { formatDate, money } from '../lib'
import { Button, Card, Chevron, Input, Label, Markdown, OpenLink, PageHeader, Section, Select, Tag, Textarea } from '../components/ui'

const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)

export default function ProfilePage() {
  const { profile, setProfile, toast } = useData()
  const [form, setForm] = useState<Profile | null>(profile)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)

  useEffect(() => setForm(profile), [profile])

  if (!form || !profile) return null
  // With no profile on disk yet there is nothing to view, so start in the form.
  const isEditing = editing || !profile.exists
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setForm({ ...form, [k]: v })
  const setU = (k: keyof Profile['undergrad'], v: string) => setForm({ ...form, undergrad: { ...form.undergrad, [k]: v } })

  const save = async () => {
    setSaving(true)
    try {
      const saved = await api.saveProfile(form)
      setProfile(saved)
      setEditing(false)
      toast('Profile saved to Common/Profile.md')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const text = (k: keyof Profile, label: string, ph?: string) => (
    <div>
      <Label>{label}</Label>
      <Input value={(form[k] as string) ?? ''} onChange={(e) => set(k, e.target.value as never)} placeholder={ph} />
    </div>
  )
  const csv = (k: 'interests' | 'target_countries' | 'degree_types', label: string, ph: string) => (
    <div>
      <Label hint="comma-separated">{label}</Label>
      <Input defaultValue={form[k].join(', ')} key={form[k].join(',')} onBlur={(e) => set(k, list(e.target.value))} placeholder={ph} />
    </div>
  )


  return (
    <>
      <PageHeader
        title="Profile"
        subtitle="Saved to Common/Profile.md. Claude reads this, your master resume and your test scores for scoring, research and essay coaching."
        actions={
          isEditing ? (
            <>
              {profile.exists && (
                <Button variant="ghost" onClick={() => (setForm(profile), setEditing(false))}>
                  Cancel
                </Button>
              )}
              <Button variant="primary" onClick={save} loading={saving}>
                Save profile
              </Button>
            </>
          ) : (
            <Button onClick={() => setEditing(true)}>Edit profile</Button>
          )
        }
      />
      <div className="grid items-start gap-x-14 gap-y-10 lg:grid-cols-3">
        {!isEditing ? (
          <ProfileView profile={profile} />
        ) : (
        <div className="space-y-5 lg:col-span-2">
          <Card title="About you">
            <div className="grid gap-4 sm:grid-cols-2">
              {text('name', 'Name')}
              {text('email', 'Email')}
              {text('nationality', 'Nationality / citizenship', 'Affects scholarship eligibility and fees')}
              {text('current_role', 'Current role', 'e.g. Data Scientist I at …')}
            </div>
          </Card>

          <Card title="Undergraduate">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>University</Label>
                <Input value={form.undergrad.university} onChange={(e) => setU('university', e.target.value)} />
              </div>
              <div>
                <Label>Degree</Label>
                <Input value={form.undergrad.degree} onChange={(e) => setU('degree', e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>GPA</Label>
                  <Input value={form.undergrad.gpa} onChange={(e) => setU('gpa', e.target.value)} />
                </div>
                <div>
                  <Label>Scale</Label>
                  <Input value={form.undergrad.scale} onChange={(e) => setU('scale', e.target.value)} placeholder="4.0" />
                </div>
              </div>
              <div>
                <Label>Graduated</Label>
                <Input value={form.undergrad.graduated} onChange={(e) => setU('graduated', e.target.value)} placeholder="May 2025" />
              </div>
            </div>
          </Card>

          <Card title="What you're looking for">
            <div className="grid gap-4 sm:grid-cols-2">
              {csv('interests', 'Research / career interests', 'ML, causal inference, …')}
              {csv('target_countries', 'Target countries', 'Canada, USA, Germany')}
              {csv('degree_types', 'Degree types', 'MSc thesis, MS course-based, MEng')}
              {text('target_intake', 'Target intake', 'Fall 2027')}
              <div>
                <Label>Budget (USD / year, all-in)</Label>
                <Input type="number" value={form.budget_usd_per_year ?? ''} onChange={(e) => set('budget_usd_per_year', e.target.value === '' ? null : Number(e.target.value))} />
              </div>
              <div>
                <Label>Funding need</Label>
                <Select value={form.funding_need} onChange={(e) => set('funding_need', e.target.value)}>
                  <option value="">—</option>
                  <option value="full">Need full funding</option>
                  <option value="partial">Need partial funding</option>
                  <option value="none">Can self-fund</option>
                </Select>
              </div>
            </div>
            <div className="mt-4">
              <Label>Goals</Label>
              <Textarea value={form.goals} onChange={(e) => set('goals', e.target.value)} rows={3} placeholder="What you want from the degree and after it." />
            </div>
          </Card>

          <Card title="Anything else Claude should know">
            <Textarea value={form.body} onChange={(e) => set('body', e.target.value)} rows={8} className="font-mono text-xs" placeholder="Markdown. Strengths, weak spots, constraints, the story you want to tell…" />
          </Card>
        </div>
        )}

        <aside className="space-y-10">
          <Section title="Tests" open={{ to: '/you/tests', label: 'Tests' }}>
            {profile.tests?.length ? (
              <ul className="divide-y divide-line">
                {profile.tests.map((t) => (
                  <li key={`${t.name}-${t.date}`} className="flex items-baseline justify-between gap-3 py-2.5 text-sm">
                    <span>
                      {t.name}
                      <span className="text-muted">, {formatDate(t.date)}</span>
                    </span>
                    <span className="num font-medium">{t.total ?? 'booked'}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-2 text-sm text-muted">No scores yet.</p>
            )}
          </Section>
          <Section title="Elsewhere">
            <ul className="divide-y divide-line text-sm">
              {(
                [
                  ['/you/files', 'Files', 'Your CVs, transcript and score reports'],
                  ['/apply/letters', 'Letters', 'Who writes your letters, in Apply'],
                  ['/money', 'Costs', 'Card charges, cost against funding'],
                  ['/town', 'Agent Town', 'AI usage and agent history'],
                ] as const
              ).map(([to, label, note]) => (
                <li key={to}>
                  <Link to={to} className="group flex items-center justify-between gap-3 py-2.5">
                    <span>
                      <span className="group-hover:text-live">{label}</span>
                      <span className="block text-xs text-muted">{note}</span>
                    </span>
                    <Chevron className="text-muted group-hover:text-live" />
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        </aside>
      </div>
    </>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted">{label}</div>
      <div className="text-sm">{children || <span className="text-muted">—</span>}</div>
    </div>
  )
}

function Chips({ items }: { items: string[] }) {
  if (!items.length) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((i) => (
        <Tag key={i} tone="grey">
          {i}
        </Tag>
      ))}
    </div>
  )
}

const FUNDING: Record<string, string> = { full: 'Needs full funding', partial: 'Needs partial funding', none: 'Can self-fund' }

function ProfileView({ profile: p }: { profile: Profile }) {
  const u = p.undergrad
  const w = p.shortlist_weights
  return (
    <div className="space-y-5 lg:col-span-2">
      <section className="pb-2">
        <div className="flex items-start gap-4">
          <div className="min-w-0">
            <h2 className="font-display text-[2rem] leading-tight">{p.name || 'Unnamed'}</h2>
            <div className="text-sm text-muted">{[p.current_role, p.nationality].filter(Boolean).join(', ')}</div>
            {p.email && (
              <a href={`mailto:${p.email}`} className="text-sm text-live hover:underline">
                {p.email}
              </a>
            )}
          </div>
        </div>
        {p.goals && <p className="mt-4 text-sm leading-relaxed text-text/90">{p.goals}</p>}
      </section>

      <div className="grid gap-5 md:grid-cols-2">
        <Card title="Undergraduate">
          <div className="space-y-3">
            <Field label="University">{u.university}</Field>
            <Field label="Degree">{u.degree}</Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="GPA">{u.gpa && `${u.gpa}${u.scale ? ` / ${u.scale}` : ''}`}</Field>
              <Field label="Graduated">{u.graduated}</Field>
            </div>
          </div>
        </Card>

        <Card title="Applying for">
          <div className="space-y-3">
            <Field label="Intake">{p.target_intake}</Field>
            <Field label="Countries">
              <Chips items={p.target_countries} />
            </Field>
            <Field label="Degree types">
              <Chips items={p.degree_types} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Funding">{FUNDING[p.funding_need] ?? p.funding_need}</Field>
              <Field label="Budget / year">{p.budget_usd_per_year ? money(p.budget_usd_per_year) : 'Not set'}</Field>
            </div>
          </div>
        </Card>
      </div>

      <Card title="Interests and priorities">
        <Chips items={p.interests} />
        <div className="mt-5 flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
          <span className="text-muted">Score weighting</span>
          {(['fit', 'cost', 'admit', 'career'] as const).map((k) => (
            <span key={k}>
              <span className="num font-medium">{Math.round((w[k] / (w.fit + w.cost + w.admit + w.career || 1)) * 100)}%</span> <span className="text-muted">{k}</span>
            </span>
          ))}
          <OpenLink to="/applications?view=compare">Change</OpenLink>
        </div>
      </Card>

      {p.body.trim() && (
        <Card title="Notes for Claude">
          <Markdown>{p.body.replace(/^# Profile\s*\n/, '')}</Markdown>
        </Card>
      )}
    </div>
  )
}
