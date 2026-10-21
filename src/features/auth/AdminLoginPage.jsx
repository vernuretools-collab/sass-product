import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Mail, Lock, ArrowRight, AlertCircle } from 'lucide-react'
import { Button } from '../../shared/components/ui/Button'
import { Input } from '../../shared/components/ui/Input'
import { Card } from '../../shared/components/ui/Card'
import haloLogo from '../../assets/halologo.png'
import { loginWithEmail, fetchCustomClaims } from '../../shared/services/authService'
import { useUserStore } from '../../shared/stores/userStore'

export const AdminLoginPage = () => {
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
        setError('This account is not in a company circle.')
        setLoading(false)
        return
      }
      setUser(user, null, { ...claims, orgId, role: claims?.role || 'owner', tier: claims?.tier || 'company' })
      navigate('/dashboard')
    } catch (err) {
      console.error('Login error:', err)
      if (err.code === 'auth/wrong-password') {
        setError('Incorrect password. Please try again.')
      } else if (err.code === 'auth/user-not-found') {
        setError('Account does not exist. Contact administrator.')
      } else {
        setError(err.message || 'Login failed.')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleClick = async () => {
    setError('Google sign-in does not create a company circle. Use email signup instead.')
  }

  return (
    <div className="min-h-screen bg-canvas text-fg flex items-center justify-center p-4 relative overflow-hidden transition-colors duration-200">
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-accent/15 blur-[120px] rounded-full pointer-events-none" />

      <Card className="w-full max-w-md p-8 relative z-10 border-accent/30 shadow-xl dark:shadow-2xl space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex w-20 h-20 rounded-full bg-white p-2 items-center justify-center border border-slate-200 dark:border-slate-700/80 shadow-md mb-2">
            <img src={haloLogo} alt="The Halo Effect Consulting" className="w-full h-full object-contain rounded-full" />
          </div>
          <h2 className="text-2xl font-bold text-fg tracking-tight">Founder & Admin Login</h2>
          <p className="text-xs text-muted">Executive Workspace & Operations Management</p>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
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

          <Button type="submit" variant="primary" className="w-full mt-2" disabled={loading} icon={ArrowRight}>
            {loading ? 'Authenticating Admin...' : 'Sign In to Executive Suite'}
          </Button>
        </form>

        <div className="relative text-center">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border" />
          </div>
          <span className="relative bg-surface px-3 text-[11px] text-muted uppercase tracking-wider">
            Or SSO
          </span>
        </div>

        <Button
          type="button"
          variant="secondary"
          className="w-full text-xs"
          onClick={handleGoogleClick}
          disabled={loading}
        >
          Sign In with Google SSO
        </Button>
      </Card>
    </div>
  )
}
