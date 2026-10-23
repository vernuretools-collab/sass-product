import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

const empty = { companyName: '', adminName: '', email: '', password: '' }

export function BuyPage() {
  const [params] = useSearchParams()
  const [form, setForm] = useState(empty)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const canceled = params.get('canceled') === '1'

  const setField = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
    if (!supabaseUrl) {
      setError('Checkout is not configured.')
      return
    }

    setSaving(true)
    const anonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '')
    const headers = { 'Content-Type': 'application/json' }
    if (anonKey) {
      headers.apikey = anonKey
      headers.Authorization = `Bearer ${anonKey}`
    }

    let response
    try {
      response = await fetch(`${supabaseUrl}/functions/v1/create-checkout`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          companyName: form.companyName.trim(),
          adminName: form.adminName.trim(),
          email: form.email.trim(),
          password: form.password,
        }),
      })
    } catch {
      setSaving(false)
      setError('Could not reach checkout.')
      return
    }

    const body = await response.json().catch(() => ({}))
    if (!response.ok || !body.url) {
      setSaving(false)
      setError(body.error || 'Could not start checkout.')
      return
    }

    window.location.assign(body.url)
  }

  return (
    <main className="max-w-5xl mx-auto px-4 py-16">
      <div className="max-w-xl">
        <p className="text-xs uppercase tracking-[0.18em] text-accent font-semibold">Monthly workspace</p>
        <h1 className="text-4xl font-semibold mt-2">Buy Business OS</h1>
        <p className="text-muted mt-3">
          Pay for one company. After Stripe confirms the subscription, that company opens and you sign in as its admin.
        </p>
      </div>

      <form onSubmit={submit} className="mt-8 bg-white border border-line rounded-2xl p-5 grid gap-3 max-w-xl">
        {canceled && (
          <p className="text-sm text-muted bg-[#eef3f1] rounded-xl px-3 py-2">
            Payment was canceled. You can try again when you are ready.
          </p>
        )}
        <label className="text-sm font-medium">
          Company name
          <input required minLength={2} value={form.companyName} onChange={setField('companyName')} className="mt-1 w-full rounded-xl border border-line px-3 py-2" />
        </label>
        <label className="text-sm font-medium">
          Your name
          <input required value={form.adminName} onChange={setField('adminName')} className="mt-1 w-full rounded-xl border border-line px-3 py-2" />
        </label>
        <label className="text-sm font-medium">
          Admin email
          <input required type="email" value={form.email} onChange={setField('email')} className="mt-1 w-full rounded-xl border border-line px-3 py-2" />
        </label>
        <label className="text-sm font-medium">
          Password
          <input required type="password" minLength={10} value={form.password} onChange={setField('password')} className="mt-1 w-full rounded-xl border border-line px-3 py-2" />
        </label>
        <p className="text-sm text-muted">At least 10 characters. This is the login for the admin portal. Employees and clients are added after you sign in.</p>
        {error && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{error}</p>}
        <div className="flex items-center gap-4">
          <button type="submit" disabled={saving} className="rounded-xl bg-accent text-white px-4 py-2.5 font-medium disabled:opacity-60">
            {saving ? 'Redirecting to payment…' : 'Continue to payment'}
          </button>
          <Link to="/product" className="text-sm text-muted">See what is included</Link>
        </div>
      </form>
    </main>
  )
}
