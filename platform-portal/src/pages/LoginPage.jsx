import { useState } from 'react'
import { platformRole, supabase } from '../lib/supabase'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!supabase) {
      setError('Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in platform-portal/.env')
      return
    }
    setLoading(true)
    setError('')
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    if (signInError) {
      setError(signInError.message)
      setLoading(false)
      return
    }
    if (platformRole(data.user) !== 'operator') {
      await supabase.auth.signOut()
      setError('This login is for the platform operator. Company admins use the admin portal.')
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-md bg-white border border-line rounded-2xl p-8 shadow-sm space-y-5">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-accent font-semibold">Parent app</p>
          <h1 className="text-2xl font-semibold mt-2">Manage companies</h1>
          <p className="text-sm text-muted mt-2">Only the platform operator can open a company circle.</p>
        </div>
        {error && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{error}</p>}
        <label className="block text-sm font-medium">
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 w-full rounded-xl border border-line px-3 py-2"
          />
        </label>
        <label className="block text-sm font-medium">
          Password
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1 w-full rounded-xl border border-line px-3 py-2"
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-accent text-white py-2.5 font-medium disabled:opacity-60"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}
