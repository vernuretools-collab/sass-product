# Business OS

Each company is a private circle. A customer buys one from the public website, and payment opens that company. You can still open or suspend companies from the parent app.

Use a new Supabase project for this folder. The older CRM database still shares one employee list.

## Stack

- Public website (`website`) and parent app (`platform-portal`)
- React + Vite portals (`admin-portal`, `employee-portal`, `client-portal`)
- Supabase Auth, Postgres, Storage, Edge Functions

## Setup

1. Create a Supabase project (or `npx supabase start` locally).
2. `npx supabase db push` / `npx supabase migration up` to apply `supabase/migrations`.
3. Copy `.env.example` to `platform-portal/.env` and to each portal `.env`. Copy `website/.env.example` to `website/.env`. Set:

```
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=...
VITE_ADMIN_PORTAL_URL=http://localhost:3001
```

Set the billing secrets on the Supabase project (do not commit them):

```
npx supabase secrets set STRIPE_SECRET_KEY=sk_... STRIPE_WEBHOOK_SECRET=whsec_... STRIPE_PRICE_ID=price_... WEBSITE_ORIGIN=http://localhost:3000
```

`STRIPE_PRICE_ID` is a monthly Stripe price. Point the Stripe webhook at `/functions/v1/stripe-webhook` for `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, and `customer.subscription.deleted`.

4. Create your operator user in Supabase Auth, then set the platform claim once:

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
  || '{"platform_role":"operator"}'::jsonb
where email = 'you@yourcompany.com';
```

5. `npm install` in `website`, `platform-portal`, and each portal.
6. Deploy functions: `npx supabase functions deploy create-user ask-admin-assistant send-workflow-email create-checkout stripe-webhook`

## Run

```
cd website && npm run dev            # :3000
cd platform-portal && npm run dev    # :3004
cd admin-portal && npm run dev       # :3001
cd employee-portal && npm run dev    # :3002
cd client-portal && npm run dev      # :3003
```

Buy a workspace at http://localhost:3000/buy. After payment, the company admin signs in on port 3001. The parent app on port 3004 still lists every company.


## Import live Firebase data

See [scripts/migrate/README.md](scripts/migrate/README.md). One-way copy only.

## FCM

Push via FCM is not ported. In-app notifications still write to `notification_items`.
