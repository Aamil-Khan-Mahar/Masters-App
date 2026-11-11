import { useState } from 'react'
import { api } from '../api'
import { useData } from '../data'
import { appPath, cx, formatDate, money, stillResearching, shortName } from '../lib'
import { useHomeMoney } from '../homeMoney'
import { Input, PageHeader, Row, Section, Tag } from '../components/ui'

/** What each program would cost against the funding it offers, and your card charges. Application fees are paid in Apply. */
export default function Money() {
  const { apps, profile, setProfile, toast } = useData()
  const { charges, home, surchargePct, fx } = useHomeMoney()
  const compare = home === 'USD' ? 'EUR' : 'USD'
  const [withResearching, setWithResearching] = useState(false)

  const live = apps.filter((a) => !a.archived && (withResearching || !stillResearching(a)))

  const saveCharges = async (k: 'fx_fee_pct' | 'tax_on_fee_pct', v: string) => {
    if (!profile || v === '' || Number(v) === profile.card_charges[k]) return
    await saveProfile({ ...profile, card_charges: { ...profile.card_charges, [k]: Number(v) } })
  }

  const saveHome = async (v: string) => {
    const code = v.trim().toUpperCase()
    if (!profile || !/^[A-Z]{3}$/.test(code) || code === home) return
    await saveProfile({ ...profile, home_currency: code })
  }

  const saveProfile = async (next: NonNullable<typeof profile>) => {
    setProfile(next)
    try {
      setProfile(await api.saveProfile(next))
      toast('Card charges saved')
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  const programs = live
    .filter((a) => a.kind === 'program')
    .map((a) => {
      const cost = (a.tuition_usd_per_year ?? 0) + (a.living_usd_per_year ?? 0)
      const pkg = a.funding_details?.typical_package_usd_per_year ?? 0
      return { a, cost, pkg, gap: cost ? Math.max(0, cost - pkg) : null }
    })
    .sort((x, y) => (x.gap ?? 1e12) - (y.gap ?? 1e12))
  const scholarships = live.filter((a) => a.kind === 'scholarship')
  const budget = profile?.budget_usd_per_year ?? null

  return (
    <>
      <PageHeader
        title="Costs"
        subtitle="What each program would cost you a year against the funding it offers. Application fees are paid in Apply."
        actions={
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={withResearching} onChange={(e) => setWithResearching(e.target.checked)} className="h-4 w-4 accent-[var(--color-live)]" />
            Include researching
          </label>
        }
      />

      <section className="mb-12 grid grid-cols-2 gap-x-10 gap-y-6 border-y border-line py-6">
        <Figure label="Card surcharge" value={`${surchargePct.toFixed(2)}%`} hint={`${charges.fx_fee_pct}% bank fee + ${charges.tax_on_fee_pct}% tax on it`} />
        <Figure label={`1 ${compare}`} value={fx?.base === home && fx.rates[compare] ? money(1 / fx.rates[compare], home) : '—'} hint={fx ? `Rates ${fx.stale ? 'saved' : 'updated'} ${fx.updated ? formatDate(new Date(fx.updated).toISOString().slice(0, 10)) : ''}` : 'Loading rates'} />
      </section>

      <div className="grid items-start gap-x-14 gap-y-12 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="space-y-12">
          <Section title="Card charges">
            <p className="max-w-[70ch] py-2 text-sm leading-relaxed text-muted">
              Foreign fees paid with your card cost the day's rate plus your bank's foreign-transaction fee, plus any tax charged on that fee. Your bank's schedule of charges lists the fee.
            </p>
            <div className="grid max-w-xl grid-cols-3 gap-4 pt-2">
              <label>
                <span className="mb-1.5 block text-sm text-muted">Card currency</span>
                <Input defaultValue={home} key={`home-${home}`} maxLength={3} onBlur={(e) => saveHome(e.target.value)} />
              </label>
              <label>
                <span className="mb-1.5 block text-sm text-muted">Bank fee (%)</span>
                <Input type="number" step="0.01" defaultValue={charges.fx_fee_pct} key={`fx-${charges.fx_fee_pct}`} onBlur={(e) => saveCharges('fx_fee_pct', e.target.value)} />
              </label>
              <label>
                <span className="mb-1.5 block text-sm text-muted">Tax on the fee (%)</span>
                <Input type="number" step="0.01" defaultValue={charges.tax_on_fee_pct} key={`tax-${charges.tax_on_fee_pct}`} onBlur={(e) => saveCharges('tax_on_fee_pct', e.target.value)} />
              </label>
            </div>
          </Section>
        </div>

        <div className="space-y-12">
          <Section title="Cost against funding" aside={budget ? <span className="text-muted">Your budget {money(budget)} a year</span> : undefined}>
            {programs.length === 0 ? (
              <p className="py-3 text-sm text-muted">Shortlist a program, or tick Include researching.</p>
            ) : (
              <ul className="divide-y divide-line">
                {programs.map(({ a, cost, pkg, gap }) => (
                  <li key={a.id}>
                    <Row
                      to={`${appPath(a)}?tab=funding`}
                      title={shortName(a)}
                      meta={cost ? `${money(cost)} a year, ${pkg ? `${money(pkg)} typical funding` : 'funding unknown'}` : 'Cost not researched yet'}
                      trail={
                        gap === null ? (
                          <span className="text-sm text-muted">—</span>
                        ) : (
                          <div>
                            <div className={cx('num font-medium', gap === 0 ? 'text-t-green' : budget && gap > budget ? 'text-danger' : 'text-accent')}>{gap === 0 ? 'Covered' : money(gap)}</div>
                            <div className="text-xs text-muted">{gap === 0 ? 'by funding' : 'to cover a year'}</div>
                          </div>
                        )
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Scholarships" count={scholarships.length} open={{ to: '/scholarships', label: 'Scholarships' }}>
            {scholarships.length === 0 ? (
              <p className="py-3 text-sm text-muted">No shortlisted scholarships. Shortlist one, or tick Include researching.</p>
            ) : (
              <ul className="divide-y divide-line">
                {scholarships.map((s) => (
                  <li key={s.id}>
                    <Row to={appPath(s)} title={s.name} meta={s.coverage || 'Coverage unknown'} trail={<Tag family="stage" value={s.stage} />} />
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </>
  )
}

function Figure({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-sm text-muted">{label}</div>
      <div className={cx('num mt-1 truncate font-display text-[1.9rem] leading-none', tone)}>{value}</div>
      {hint && <div className="mt-1.5 truncate text-sm text-muted">{hint}</div>}
    </div>
  )
}
