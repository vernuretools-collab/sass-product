import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { CompaniesPage } from './pages/CompaniesPage'
import { LoginPage } from './pages/LoginPage'
import { platformRole, supabase } from './lib/supabase'

export function App() {
  const [session, setSession] = useState(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!supabase) {
      setReady(true)
      return undefined
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  if (!ready) {
    return <p className="p-8 text-sm text-muted">Loading…</p>
  }

  const operator = platformRole(session?.user) === 'operator'

  return (
    <Routes>
      <Route path="/login" element={operator ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/" element={operator ? <CompaniesPage session={session} /> : <Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to={operator ? '/' : '/login'} replace />} />
    </Routes>
  )
}
