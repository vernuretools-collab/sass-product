import Stripe from 'npm:stripe@17.7.0'
import { createClient } from 'npm:@supabase/supabase-js@2'

Deno.serve(async (req) => {
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '')
  const signature = req.headers.get('stripe-signature')
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET')
  if (!signature || !secret) return new Response('Stripe webhook is not configured', { status: 503 })

  const body = await req.text()
  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, secret)
  } catch (err) {
    return new Response(err instanceof Error ? err.message : 'Invalid signature', { status: 400 })
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object
    if (session.mode !== 'subscription') return received()
    if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') return received()

    const purchaseId = session.metadata?.purchase_id || session.client_reference_id || ''
    const subscriptionId = idOf(session.subscription)
    if (!purchaseId) return received()
    if (!subscriptionId) return new Response('Subscription is not ready', { status: 500 })

    const recorded = await admin.rpc('record_stripe_payment', {
      p_purchase_id: purchaseId,
      p_customer_id: idOf(session.customer),
      p_subscription_id: subscriptionId,
    })
    if (recorded.error) return new Response(recorded.error.message, { status: 500 })

    const opened = await admin.rpc('open_paid_company', { p_purchase_id: purchaseId })
    if (opened.error) return new Response(opened.error.message, { status: 500 })
  }

  if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
    const invoice = event.data.object
    const subscriptionId = subscriptionIdOf(invoice)
    if (!subscriptionId) return received()
    const status = event.type === 'invoice.paid' ? 'active' : 'past_due'
    const updated = await admin.rpc('set_company_billing_status', {
      p_subscription_id: subscriptionId,
      p_status: status,
    })
    if (updated.error) return new Response(updated.error.message, { status: 500 })
  }

  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object
    const updated = await admin.rpc('set_company_billing_status', {
      p_subscription_id: subscription.id,
      p_status: 'canceled',
    })
    if (updated.error) return new Response(updated.error.message, { status: 500 })
  }

  return received()
})

function idOf(value: unknown) {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'id' in value) return String((value as { id?: unknown }).id || '')
  return ''
}

function subscriptionIdOf(invoice: Stripe.Invoice) {
  const raw = invoice as Stripe.Invoice & {
    subscription?: unknown
    parent?: { type?: string; subscription_details?: { subscription?: unknown } }
  }
  const legacy = idOf(raw.subscription)
  if (legacy) return legacy
  if (raw.parent?.type === 'subscription_details') return idOf(raw.parent.subscription_details?.subscription)
  return ''
}

function received() {
  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
