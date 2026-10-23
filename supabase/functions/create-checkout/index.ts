import Stripe from 'npm:stripe@17.7.0'
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const body = await req.json().catch(() => ({}))

  const supabaseUrlForStatus = Deno.env.get('SUPABASE_URL')
  const serviceKeyForStatus = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (body.action === 'status') {
    // Used by the success page: report only the purchase status for a Checkout session id.
    const sessionId = text(body.sessionId)
    if (!/^cs_[A-Za-z0-9_]{8,200}$/.test(sessionId)) return json({ status: 'unknown' })
    if (!supabaseUrlForStatus || !serviceKeyForStatus) return json({ error: 'Checkout is not configured.' }, 503)
    const statusClient = createClient(supabaseUrlForStatus, serviceKeyForStatus)
    const { data, error } = await statusClient.rpc('purchase_status_for_session', { p_session_id: sessionId })
    if (error) {
      console.error('[create-checkout] status lookup failed:', error)
      return json({ error: 'Could not check the purchase.' }, 500)
    }
    return json({ status: String(data?.status || 'unknown') })
  }

  const companyName = text(body.companyName)
  const adminName = text(body.adminName)
  const email = text(body.email)
  const password = String(body.password || '')

  const secret = Deno.env.get('STRIPE_SECRET_KEY')
  const price = Deno.env.get('STRIPE_PRICE_ID') || Deno.env.get('STRIPE_PRICE_APPS') || Deno.env.get('STRIPE_PRICE_WEBSITE')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!secret || !price || !supabaseUrl || !serviceKey) {
    return json({ error: 'Checkout is not configured.' }, 503)
  }

  const admin = createClient(supabaseUrl, serviceKey)
  const { data: purchaseId, error: prepareError } = await admin.rpc('prepare_company_purchase', {
    p_company_name: companyName,
    p_admin_name: adminName,
    p_email: email,
    p_password: password,
  })
  if (prepareError || !purchaseId) {
    return json({ error: friendlyPrepareError(prepareError?.message) }, 400)
  }

  const origin = (Deno.env.get('WEBSITE_ORIGIN') || 'http://localhost:3000').replace(/\/$/, '')
  const stripe = new Stripe(secret)
  const purchase = String(purchaseId)

  let session: Stripe.Checkout.Session
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      success_url: `${origin}/buy/success?session_id={CHECKOUT_SESSION_ID}`,
      // Stripe's minimum lifetime; the matching pending purchase expires after 35 minutes.
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      cancel_url: `${origin}/buy?canceled=1`,
      client_reference_id: purchase,
      customer_email: email,
      metadata: { purchase_id: purchase },
      subscription_data: { metadata: { purchase_id: purchase } },
    })
  } catch (err) {
    console.error('[create-checkout] Stripe session failed:', err)
    await admin.rpc('expire_company_purchase', { p_purchase_id: purchase, p_reason: 'stripe-session-failed' })
    return json({ error: 'Could not start checkout.' }, 502)
  }

  if (!session.id || !session.url) {
    return json({ error: 'Could not start checkout.' }, 502)
  }

  const { error: attachError } = await admin.rpc('attach_stripe_checkout', {
    p_purchase_id: purchaseId,
    p_session_id: session.id,
  })
  if (attachError) {
    console.error('[create-checkout] attach failed:', attachError)
    return json({ error: 'Could not start checkout.' }, 500)
  }

  return json({ url: session.url })
})

// Validation messages raised by private.prepare_company_purchase are safe to show; anything else
// (constraint names, SQL errors) is replaced by a generic message.
const SAFE_PREPARE_ERRORS = [
  'Company name is required',
  'Admin name is required',
  'A valid email is required',
  'Password must be at least 10 characters',
]

function friendlyPrepareError(message?: string) {
  const raw = String(message || '')
  if (raw.includes('checkout-in-progress')) {
    return 'A checkout for this email is already in progress. Finish it, or try again in about 30 minutes.'
  }
  if (raw.includes('checkout-unavailable')) {
    return 'We could not start a purchase for this email. If you already have an account, sign in instead or contact support.'
  }
  const safe = SAFE_PREPARE_ERRORS.find((item) => raw.includes(item))
  if (safe) return safe
  if (raw) console.error('[create-checkout] prepare failed:', raw)
  return 'Could not start checkout.'
}

function text(value: unknown) {
  return String(value || '').trim()
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  })
}
