import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Crown, Mail, Lock, ArrowRight, AlertCircle } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Card } from '../../components/ui/Card'
import { useUserStore } from '../../stores/userStore'
import haloLogo from '../../assets/halologo.png'
import { loginWithEmail, fetchCustomClaims, getUserDoc, logoutUser } from '../../shared/services/authService'
import { rejectSuspendedCompany } from '../../../../shared/supabase/companyStatus.js'
import { supabase } from '../../../../shared/supabase/client.js'

const ADMIN_ROLES = new Set(['admin', 'owner', 'superadmin'])

// Admin access comes only from the server-set JWT claim (app_metadata.role). Profile fields,
// job titles and mailbox names are user-editable and must not grant the admin portal.
async function resolveAdminAccess() {
  const { data } = await supabase.auth.getUser()
  const role = String(data?.user?.app_metadata?.role || '').toLowerCase()
  return { allowed: ADMIN_ROLES.has(role), role }
}

export const AdminLoginPage = () => {
  const navigate = useNavigate()
  const { setUser } = useUserStore()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email || !password) {
      setError('Please enter work email and password.')
      return
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    setLoading(true)
    setError('')

    try {
      // Sign in existing Admin user
      const firebaseUser = await loginWithEmail(email, password)
      const claims = await fetchCustomClaims(firebaseUser, true)
      const userDoc = await getUserDoc(firebaseUser.uid)
      const access = await resolveAdminAccess()

      if (!access.allowed) {
        await logoutUser()
        setError('Access Denied: This is not a company admin account. Employees and clients use their own portals.')
        setLoading(false)
        return
      }

      const freshClaims = await fetchCustomClaims(firebaseUser, true)
      const orgId = freshClaims?.orgId || claims?.orgId || null
      if (!orgId) {
        await logoutUser()
        setError('This account is not in a company circle. Ask the platform administrator to open your company.')
        setLoading(false)
        return
      }
      await rejectSuspendedCompany(logoutUser)
      setUser(firebaseUser, { ...(userDoc || {}), role: access.role, orgId }, {
        ...freshClaims,
        orgId,
        role: access.role,
        tier: freshClaims?.tier || claims?.tier || 'company',
      })
      navigate('/dashboard')
    } catch (err) {
      console.error('Firebase Auth error:', err)
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setError('Incorrect email or password. Please try again.')
      } else if (err.code === 'auth/user-not-found') {
        setError('No account found with this email.')
      } else if (err.code === 'auth/weak-password') {
        setError('Password should be at least 6 characters.')
      } else {
        setError(err.message || 'Authentication failed. Please check credentials.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-canvas text-fg flex items-center justify-center p-4 relative overflow-hidden transition-colors duration-200">
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-accent/15 blur-[120px] rounded-full pointer-events-none" />

      <Card className="w-full max-w-md p-8 relative z-10 border-accent/30 shadow-xl dark:shadow-2xl space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex w-20 h-20 rounded-full bg-white p-2 items-center justify-center border border-slate-200 dark:border-slate-700/80 shadow-md mb-2">
            <img src={haloLogo} alt="The Halo Effect Consulting" className="w-full h-full object-contain rounded-full" />
          </div>
          <h2 className="text-2xl font-bold text-fg tracking-tight">
            Founder & Admin Login
          </h2>
          <p className="text-xs text-muted">
            Executive Workspace & Operations Management
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Admin Work Email"
            type="email"
            placeholder="admin@yourcompany.com"
            icon={Mail}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <Input
            label="Password"
            type="password"
            placeholder="••••••••"
            icon={Lock}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          <Button
            type="submit"
            variant="primary"
            className="w-full mt-2"
            disabled={loading}
            icon={ArrowRight}
          >
            {loading ? 'Authenticating...' : 'Sign In'}
          </Button>
        </form>
      </Card>
    </div>
  )
}
