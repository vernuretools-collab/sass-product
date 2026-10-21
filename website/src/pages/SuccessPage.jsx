export function SuccessPage() {
  const adminUrl = String(import.meta.env.VITE_ADMIN_PORTAL_URL || 'http://localhost:3001')

  return (
    <main className="max-w-5xl mx-auto px-4 py-16">
      <div className="max-w-xl bg-white border border-line rounded-2xl p-6 space-y-4">
        <p className="text-xs uppercase tracking-[0.18em] text-accent font-semibold">Payment received</p>
        <h1 className="text-4xl font-semibold">Your workspace is opening</h1>
        <p className="text-muted">
          Stripe is confirming the subscription. When it finishes, sign in to the admin portal with the email and password you just chose.
        </p>
        <a href={adminUrl} className="inline-flex rounded-xl bg-accent text-white px-4 py-2.5 font-medium">
          Go to the admin portal
        </a>
      </div>
    </main>
  )
}
