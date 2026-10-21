import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Mail, Lock, ArrowRight, AlertCircle } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Card } from '../../components/ui/Card'
import { useUserStore } from '../../stores/userStore'
import haloLogo from '../../assets/halologo.png'
import { loginWithEmail, logoutUser, signupWithEmail, fetchCustomClaims, getUserDoc } from '../../shared/services/authService'
import { isJoiningAccount } from '../../../../shared/supabase/employeeOnboarding.js'
import { rejectSuspendedCompany } from '../../../../shared/supabase/companyStatus.js'

export const EmployeeLoginPage = () => {
  const navigate = useNavigate()
  const { setUser } = useUserStore()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleRealLogin = async (e) => {
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
      const firebaseUser = await loginWithEmail(email.trim(), password)
      const claims = await fetchCustomClaims(firebaseUser, true)
      if (isJoiningAccount({ role: claims?.role, email: firebaseUser?.email })) {
        await logoutUser()
        setError('This login is only for the joining form. Open the joining page instead of the employee portal.')
        return
      }
      const userDoc = await getUserDoc(firebaseUser.uid, firebaseUser.email)
      const orgId = claims?.orgId || userDoc?.orgId || null
      if (!orgId) {
        await logoutUser()
        setError('This account is not in a company circle. Ask your company admin for an invite.')
        return
      }
      await rejectSuspendedCompany(logoutUser)
      setUser(firebaseUser, userDoc || null, {
        ...claims,
        orgId,
        role: userDoc?.role || claims?.role || 'employee',
        tier: claims?.tier || 'company',
      })
      navigate('/dashboard')
    } catch (err) {
      console.error('Employee Auth error:', err)
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setError('Incorrect email or password. Please try again.')
      } else if (err.code === 'auth/user-not-found') {
        setError('No employee account found with this email.')
      } else {
        setError(err.message || 'Authentication failed.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center p-4 relative overflow-hidden text-fg transition-colors duration-200">
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-accent/8 blur-[120px] rounded-full pointer-events-none" />

      <Card className="w-full max-w-md p-8 relative z-10 space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex w-20 h-20 rounded-full bg-white p-2 items-center justify-center border border-slate-200 dark:border-white/30 shadow-sm mb-2">
            <img src={haloLogo} alt="The Halo Effect Consulting" className="w-full h-full object-contain rounded-full" />
          </div>
          <h2 className="text-2xl font-bold text-fg tracking-tight">Employee portal</h2>
          <p className="text-xs text-muted">Sprint tasks and attendance workspace</p>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleRealLogin} className="space-y-4">
          <Input
            label="Work email"
            type="email"
            placeholder="staff@company.com"
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

          <Button type="submit" variant="primary" className="w-full mt-2" disabled={loading} icon={ArrowRight}>
            {loading ? 'Authenticating Staff...' : 'Sign In'}
          </Button>
        </form>

        <p className="text-xs text-muted text-center">
          New joining? <Link to="/joining" className="text-accent font-medium">Open joining login</Link>
        </p>
      </Card>
    </div>
  )
}
