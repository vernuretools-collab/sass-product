# Deprecated Firebase Cloud Functions

This clone uses **Supabase Edge Functions** in `../supabase/functions/`:

- `create-user` — admin creates client/employee/admin without switching session
- `ask-admin-assistant` — Gemini assistant
- `create-checkout` / `stripe-webhook` — public purchase and Stripe billing

SQL triggers replace `onUserCreated`, `onLeadWon`, announcement fan-out, and `aggregateHealthScores` (enable pg_cron using `00002_cron_health_scores.sql`).
