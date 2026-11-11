import { useEffect, useState } from 'react'
import { api, type Fx } from './api'
import { useData } from './data'

let fxLoad: Promise<Fx | null> | null = null
let fxBase = ''

/** Converts foreign fees to what your card is actually charged in your home currency (Profile `home_currency`):
 * market rate, plus the bank's foreign-transaction fee and any tax charged on that fee. */
export function useHomeMoney() {
  const { profile } = useData()
  const home = (profile?.home_currency || 'USD').toUpperCase()
  const [fx, setFx] = useState<Fx | null>(null)
  useEffect(() => {
    if (fxBase !== home) {
      fxBase = home
      fxLoad = null
    }
    ;(fxLoad ??= api.fx().catch(() => null)).then(setFx)
  }, [home])
  const charges = profile?.card_charges ?? { fx_fee_pct: 0, tax_on_fee_pct: 0 }
  const surchargePct = charges.fx_fee_pct * (1 + charges.tax_on_fee_pct / 100)
  const toHome = (amount: number | null | undefined, currency = 'USD'): number | null => {
    if (amount == null || Number.isNaN(amount)) return null
    const cur = (currency || 'USD').toUpperCase()
    if (cur === home) return amount // paid in your own currency, no card surcharge
    const rate = fx?.base === home ? fx.rates[cur] : undefined
    return rate ? (amount / rate) * (1 + surchargePct / 100) : null
  }
  return { toHome, home, charges, surchargePct, fx }
}
