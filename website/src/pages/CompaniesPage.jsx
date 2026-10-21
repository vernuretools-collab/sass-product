const steps = [
  'You pay for a monthly workspace from this website.',
  'After payment, your company circle opens and you are its admin.',
  'Sign in to the admin portal and add your own employees and clients.',
  'If the subscription ends, those logins stop until it is paid again.',
]

export function CompaniesPage() {
  return (
    <main className="max-w-5xl mx-auto px-4 py-16 space-y-8">
      <h1 className="text-4xl font-semibold">How a company is opened</h1>
      <p className="text-muted max-w-2xl">
        A customer buys one company. That purchase opens a private circle for the admin, employee, and client portals. People from one company never appear in another.
      </p>
      <ol className="space-y-3">
        {steps.map((step, index) => (
          <li key={step} className="bg-white border border-line rounded-2xl px-5 py-4 flex gap-4">
            <span className="text-accent font-semibold">{index + 1}</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </main>
  )
}
