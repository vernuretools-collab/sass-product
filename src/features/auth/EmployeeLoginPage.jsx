import React, { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { UserCheck, Mail, Lock, ArrowRight, AlertCircle } from 'lucide-react'
import { Button } from '../../shared/components/ui/Button'
import { Input } from '../../shared/components/ui/Input'
import { Card } from '../../shared/components/ui/Card'
import { loginWithEmail, fetchCustomClaims, logoutUser } from '../../shared/services/authService'
import { useUserStore } from '../../shared/stores/userStore'

export const EmployeeLoginPage = () => {
  const navigate = useNavigate()
  const { setUser } = useUserStore()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async (e) => {
    e.preventDefault()
    if (!email || !password) {
      setError('Please enter work email and password.')
      return
    }

    setError('')
    setLoading(true)

    try {
      const user = await loginWithEmail(email, password)
      const claims = await fetchCustomClaims(user, true)
      const orgId = claims?.orgId || null
      if (!orgId) {
        await logoutUser()
        setError('This account is not in a company circle. Ask your company admin for an invite.')
        return
      }
      setUser(user, null, { ...claims, orgId, role: claims?.role || 'employee', tier: claims?.tier || 'company' })
      navigate('/projects/tasks')
    } catch (err) {
      console.error('Firebase Auth error:', err)
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setError('Incorrect email or password. Please try again.')
      } else if (err.code === 'auth/user-not-found') {
        setError('No account found with this email.')
      } else {
        setError(err.message || 'Authentication failed. Please check credentials.')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleClick = async () => {
    setError('Google sign-in does not join a company circle. Use the email from your company admin.')
  }

  return (
    <div className="min-h-screen bg-canvas text-fg flex items-center justify-center p-4 relative overflow-hidden transition-colors duration-200">
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-accent/15 blur-[120px] rounded-full pointer-events-none" />

      <Card className="w-full max-w-md p-8 relative z-10 border-accent/30 shadow-xl dark:shadow-2xl space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex w-12 h-12 rounded-2xl bg-accent-soft text-accent items-center justify-center border border-accent/30 mb-1">
            <UserCheck className="w-6 h-6" />
          </div>
          <h2 className="text-2xl font-bold text-fg tracking-tight">Employee EMPLOYEE PORTAL</h2>
          <p className="text-xs text-muted">Sprint Tasks, Time Tracker & Attendance Sign-In</p>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <Input
            label=" EMPLOYEEWork Email"
            type="email"
            placeholder="name@company.com"
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

          <Button type="submit" variant="primary" className="w-full mt-2 bg-accent hover:bg-accent-hover" disabled={loading} icon={ArrowRight}>
            {loading ? 'Authenticating Staff...' : 'Sign In to   EMPLOYEE Workspace'}
          </Button>
        </form>

        <div className="relative text-center">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border" />
          </div>
          <span className="relative bg-surface px-3 text-[11px] text-muted uppercase tracking-wider">
            Or  EMPLOYEESSO
          </span>
        </div>

        <Button
          type="button"
          variant="secondary"
          className="w-full text-xs"
          onClick={handleGoogleClick}
          disabled={loading}
        >
          Sign In with  EMPLOYEEGoogle SSO
        </Button>

        <div className="pt-2 text-center text-xs text-muted flex justify-between">
          <Link to="/login/admin" className="hover:text-accent dark:hover:text-accent font-medium">Admin Login →</Link>
          <Link to="/login/client" className="hover:text-emerald-600 dark:hover:text-emerald-400 font-medium">Client Login →</Link>
        </div>
      </Card>
    </div>
  )
}
