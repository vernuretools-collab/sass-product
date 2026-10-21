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
    return json({ error: prepareError?.message || 'Could not start checkout.' }, 400)
  }

  const origin = (Deno.env.get('WEBSITE_ORIGIN') || 'http://localhost:3000').replace(/\/$/, '')
  const stripe = new Stripe(secret)
  const purchase = String(purchaseId)

  let session: Stripe.Checkout.Session
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      success_url: `${origin}/buy/success`,
      cancel_url: `${origin}/buy?canceled=1`,
      client_reference_id: purchase,
      customer_email: email,
      metadata: { purchase_id: purchase },
      subscription_data: { metadata: { purchase_id: purchase } },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not start checkout.'
    return json({ error: message }, 502)
  }

  if (!session.id || !session.url) {
    return json({ error: 'Could not start checkout.' }, 502)
  }

  const { error: attachError } = await admin.rpc('attach_stripe_checkout', {
    p_purchase_id: purchaseId,
    p_session_id: session.id,
  })
  if (attachError) {
    return json({ error: attachError.message }, 500)
  }

  return json({ url: session.url })
})

function text(value: unknown) {
  return String(value || '').trim()
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  })
}
