import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function CompaniesPage({ session }) {
  const [companies, setCompanies] = useState([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ companyName: '', adminName: '', email: '', password: '' })

  const load = async () => {
    setError('')
    const { data, error: listError } = await supabase.rpc('list_companies')
    if (listError) {
      setError(listError.message)
      setCompanies([])
    } else {
      setCompanies(Array.isArray(data) ? data : [])
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const setField = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))

  const createCompany = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    const { error: createError } = await supabase.rpc('create_company_as_operator', {
      p_company_name: form.companyName.trim(),
      p_admin_name: form.adminName.trim(),
      p_email: form.email.trim(),
      p_password: form.password,
    })
    setSaving(false)
    if (createError) {
      setError(createError.message)
      return
    }
    setNotice(`${form.companyName.trim()} is open. The admin can sign in at the admin portal.`)
    setForm({ companyName: '', adminName: '', email: '', password: '' })
    await load()
  }

  const setStatus = async (company, status) => {
    setError('')
    setNotice('')
    const { error: statusError } = await supabase.rpc('set_company_status', {
      p_org_id: company.id,
      p_status: status,
    })
    if (statusError) {
      setError(statusError.message)
      return
    }
    await load()
  }

  return (
    <main className="max-w-5xl mx-auto px-4 py-8 space-y-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-accent font-semibold">Parent app</p>
          <h1 className="text-3xl font-semibold mt-1">Companies</h1>
          <p className="text-sm text-muted mt-2">
            Signed in as {session?.user?.email}. Each company is a separate circle.
          </p>
        </div>
        <button
          type="button"
          onClick={() => supabase.auth.signOut()}
          className="text-sm border border-line rounded-xl px-3 py-2 bg-white"
        >
          Sign out
        </button>
      </header>

      <form onSubmit={createCompany} className="bg-white border border-line rounded-2xl p-5 grid gap-3 md:grid-cols-2">
        <h2 className="md:col-span-2 text-lg font-semibold">Open a company</h2>
        <label className="text-sm font-medium">
          Company name
          <input required value={form.companyName} onChange={setField('companyName')} className="mt-1 w-full rounded-xl border border-line px-3 py-2" />
        </label>
        <label className="text-sm font-medium">
          First admin name
          <input required value={form.adminName} onChange={setField('adminName')} className="mt-1 w-full rounded-xl border border-line px-3 py-2" />
        </label>
        <label className="text-sm font-medium">
          Admin email
          <input required type="email" value={form.email} onChange={setField('email')} className="mt-1 w-full rounded-xl border border-line px-3 py-2" />
        </label>
        <label className="text-sm font-medium">
          Temporary password
          <input required type="password" minLength={6} value={form.password} onChange={setField('password')} className="mt-1 w-full rounded-xl border border-line px-3 py-2" />
        </label>
        <div className="md:col-span-2">
          <button type="submit" disabled={saving} className="rounded-xl bg-accent text-white px-4 py-2.5 font-medium disabled:opacity-60">
            {saving ? 'Opening…' : 'Create company'}
          </button>
        </div>
      </form>

      {error && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{error}</p>}
      {notice && <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">{notice}</p>}

      <section className="bg-white border border-line rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#eef3f1] text-left">
            <tr>
              <th className="px-4 py-3 font-medium">Company</th>
              <th className="px-4 py-3 font-medium">Owner</th>
              <th className="px-4 py-3 font-medium">Plan</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Billing</th>
              <th className="px-4 py-3 font-medium">Opened</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td className="px-4 py-6 text-muted" colSpan={7}>Loading companies…</td></tr>
            )}
            {!loading && companies.length === 0 && (
              <tr><td className="px-4 py-6 text-muted" colSpan={7}>No companies yet.</td></tr>
            )}
            {companies.map((company) => {
              const suspended = company.status === 'suspended'
              return (
                <tr key={company.id} className="border-t border-line">
                  <td className="px-4 py-3 font-medium">{company.name}</td>
                  <td className="px-4 py-3">{company.owner_email || '—'}</td>
                  <td className="px-4 py-3 capitalize">{company.plan || '—'}</td>
                  <td className="px-4 py-3 capitalize">{company.status}</td>
                  <td className="px-4 py-3">{company.purchased ? 'Purchased' : 'Opened here'}</td>
                  <td className="px-4 py-3">{formatDate(company.created_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setStatus(company, suspended ? 'active' : 'suspended')}
                      className="text-sm border border-line rounded-lg px-3 py-1.5"
                    >
                      {suspended ? 'Activate' : 'Suspend'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>
    </main>
  )
}
