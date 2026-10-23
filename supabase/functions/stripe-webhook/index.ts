import Stripe from 'npm:stripe@17.7.0'
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

// Stripe events this endpoint handles (configure the same list on the Stripe webhook):
//   checkout.session.completed, checkout.session.async_payment_succeeded,
//   checkout.session.async_payment_failed, checkout.session.expired,
//   invoice.paid, invoice.payment_failed,
//   customer.subscription.updated, customer.subscription.deleted

// Stripe subscription status -> company billing status (see private.set_company_billing_status).
const SUBSCRIPTION_STATUS: Record<string, string> = {
  active: 'active',
  trialing: 'trialing',
  past_due: 'past_due',
  unpaid: 'unpaid',
  incomplete: 'past_due',
  paused: 'past_due',
  incomplete_expired: 'canceled',
  canceled: 'canceled',
}

class WebhookError extends Error {}

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
    console.error('[stripe-webhook] signature check failed:', err)
    return new Response('Invalid signature', { status: 400 })
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  try {
    // Idempotency: an event that was fully processed before is acknowledged without re-running.
    const seen = await admin.rpc('stripe_event_processed', { p_event_id: event.id })
    if (seen.error) throw seen.error
    if (seen.data === true) return received()

    await handle(event, stripe, admin)

    // Recorded only after success, so a failed attempt is retried by Stripe.
    const marked = await admin.rpc('mark_stripe_event_processed', {
      p_event_id: event.id,
      p_event_type: event.type,
    })
    if (marked.error) throw marked.error
    return received()
  } catch (err) {
    console.error(`[stripe-webhook] ${event.type} ${event.id} failed:`, err)
    return new Response('Webhook processing failed', { status: 500 })
  }
})

async function handle(event: Stripe.Event, stripe: Stripe, admin: SupabaseClient) {
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      return openCompany(event.data.object as Stripe.Checkout.Session, stripe, admin)

    case 'checkout.session.async_payment_failed':
    case 'checkout.session.expired': {
      const session = event.data.object as Stripe.Checkout.Session
      const purchaseId = purchaseIdOf(session)
      if (!purchaseId) return
      const expired = await admin.rpc('expire_company_purchase', {
        p_purchase_id: purchaseId,
        p_reason: event.type === 'checkout.session.expired' ? 'checkout-expired' : 'payment-failed',
      })
      if (expired.error) throw expired.error
      return
    }

    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const subscriptionId = subscriptionIdOf(event.data.object as Stripe.Invoice)
      if (!subscriptionId) return
      // invoice.paid only restores billing. An operator suspension (data.status) is separate and
      // is never lifted by a payment; a canceled subscription stays canceled.
      await setBilling(admin, subscriptionId, event.type === 'invoice.paid' ? 'active' : 'past_due')
      return
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription
      const status = SUBSCRIPTION_STATUS[subscription.status]
      if (!status) return
      await setBilling(admin, subscription.id, status)
      return
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription
      await setBilling(admin, subscription.id, 'canceled')
      return
    }

    default:
      return
  }
}

async function openCompany(session: Stripe.Checkout.Session, stripe: Stripe, admin: SupabaseClient) {
  if (session.mode !== 'subscription') return
  // Delayed payment methods complete later with checkout.session.async_payment_succeeded.
  if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') return

  const purchaseId = purchaseIdOf(session)
  const subscriptionId = idOf(session.subscription)
  if (!purchaseId) {
    console.error(`[stripe-webhook] paid session ${session.id} has no purchase id`)
    return
  }
  if (!subscriptionId) throw new WebhookError('Subscription is not ready')

  const recorded = await admin.rpc('record_stripe_payment', {
    p_purchase_id: purchaseId,
    p_customer_id: idOf(session.customer),
    p_subscription_id: subscriptionId,
  })
  if (recorded.error) throw recorded.error

  const opened = await admin.rpc('open_paid_company', { p_purchase_id: purchaseId })
  if (opened.error) throw opened.error

  const result = (opened.data || {}) as { status?: string; error?: string }
  if (result.status === 'opened') return

  // The customer paid but no company could be opened (for example the email already has an
  // account, or the purchase expired). Do not keep their money silently: cancel the subscription
  // and refund the first payment. The purchase stays visible to operators as "failed".
  console.error(`[stripe-webhook] purchase ${purchaseId} could not be opened:`, result)
  await cancelAndRefund(stripe, session, subscriptionId, purchaseId)
}

async function cancelAndRefund(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
  subscriptionId: string,
  purchaseId: string,
) {
  try {
    await stripe.subscriptions.cancel(subscriptionId)
  } catch (err) {
    const code = (err as { code?: string })?.code
    if (code !== 'resource_missing' && !/canceled/i.test(String((err as Error)?.message || ''))) throw err
  }

  const invoiceId = idOf(session.invoice)
  if (!invoiceId) return
  const invoice = await stripe.invoices.retrieve(invoiceId) as Stripe.Invoice & { payment_intent?: unknown }
  const paymentIntent = idOf(invoice.payment_intent)
  if (!paymentIntent) {
    if ((invoice.amount_paid || 0) > 0) throw new WebhookError(`No payment intent to refund for purchase ${purchaseId}`)
    return
  }
  try {
    await stripe.refunds.create(
      { payment_intent: paymentIntent, reason: 'requested_by_customer', metadata: { purchase_id: purchaseId } },
      { idempotencyKey: `purchase-refund-${purchaseId}` },
    )
  } catch (err) {
    if ((err as { code?: string })?.code !== 'charge_already_refunded') throw err
  }
}

async function setBilling(admin: SupabaseClient, subscriptionId: string, status: string) {
  const updated = await admin.rpc('set_company_billing_status', {
    p_subscription_id: subscriptionId,
    p_status: status,
  })
  if (updated.error) throw updated.error
}

function purchaseIdOf(session: Stripe.Checkout.Session) {
  const value = session.metadata?.purchase_id || session.client_reference_id || ''
  return /^[0-9a-f-]{36}$/i.test(value) ? value : ''
}

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
