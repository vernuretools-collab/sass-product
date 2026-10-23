import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

const POLL_MS = 3000
const MAX_POLLS = 40

const COPY = {
  checking: {
    tag: 'Payment received',
    title: 'Your workspace is opening',
    body: 'Stripe is confirming the subscription. This page updates when your company is ready.',
  },
  opened: {
    tag: 'Ready',
    title: 'Your workspace is open',
    body: 'Sign in to the admin portal with the email and password you just chose.',
  },
  failed: {
    tag: 'Something went wrong',
    title: 'We could not open your workspace',
    body: 'The payment went through but the company could not be created (for example, the email already has an account). The subscription is canceled and the payment refunded automatically. Contact support if you need help.',
  },
  expired: {
    tag: 'Checkout ended',
    title: 'This checkout did not complete',
    body: 'No company was opened. You can start a new purchase from the Buy page.',
  },
  slow: {
    tag: 'Still working',
    title: 'This is taking longer than usual',
    body: 'Your payment is being confirmed. Try signing in to the admin portal in a few minutes, or contact support if it does not open.',
  },
}

async function fetchStatus(sessionId) {
  const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
  if (!supabaseUrl) return 'unknown'
  const anonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '')
  const headers = { 'Content-Type': 'application/json' }
  if (anonKey) {
    headers.apikey = anonKey
    headers.Authorization = `Bearer ${anonKey}`
  }
  const response = await fetch(`${supabaseUrl}/functions/v1/create-checkout`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'status', sessionId }),
  })
  const body = await response.json().catch(() => ({}))
  return String(body.status || 'unknown')
}

export function SuccessPage() {
  const adminUrl = String(import.meta.env.VITE_ADMIN_PORTAL_URL || 'http://localhost:3001')
  const [params] = useSearchParams()
  const sessionId = params.get('session_id') || ''
  const [state, setState] = useState(sessionId ? 'checking' : 'slow')

  useEffect(() => {
    if (!sessionId) return undefined
    let cancelled = false
    let polls = 0
    let timer

    const tick = async () => {
      polls += 1
      let status = 'unknown'
      try {
        status = await fetchStatus(sessionId)
      } catch {
        status = 'unknown'
      }
      if (cancelled) return
      if (status === 'opened') return setState('opened')
      if (status === 'failed') return setState('failed')
      if (status === 'expired') return setState('expired')
      if (polls >= MAX_POLLS) return setState('slow')
      timer = setTimeout(tick, POLL_MS)
    }
    tick()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [sessionId])

  const copy = COPY[state]
  const showPortal = state === 'opened' || state === 'slow'

  return (
    <main className="max-w-5xl mx-auto px-4 py-16">
      <div className="max-w-xl bg-white border border-line rounded-2xl p-6 space-y-4">
        <p className="text-xs uppercase tracking-[0.18em] text-accent font-semibold">{copy.tag}</p>
        <h1 className="text-4xl font-semibold">{copy.title}</h1>
        <p className="text-muted">{copy.body}</p>
        {showPortal && (
          <a href={adminUrl} className="inline-flex rounded-xl bg-accent text-white px-4 py-2.5 font-medium">
            Go to the admin portal
          </a>
        )}
      </div>
    </main>
  )
}
