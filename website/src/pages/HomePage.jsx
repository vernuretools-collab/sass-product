import { Link } from 'react-router-dom'

export function HomePage() {
  return (
    <main className="max-w-5xl mx-auto px-4 py-16 space-y-8">
      <p className="text-xs uppercase tracking-[0.18em] text-accent font-semibold">Sold as a company workspace</p>
      <h1 className="text-4xl md:text-5xl font-semibold leading-tight max-w-3xl">
        One private workspace for every company you sell to.
      </h1>
      <p className="text-lg text-muted max-w-2xl">
        Business OS is the admin, employee, and client product. Each company stays in its own circle, so staff and clients from one company never appear in another.
      </p>
      <Link to="/buy" className="inline-flex rounded-xl bg-accent text-white px-4 py-2.5 font-medium">Buy a workspace</Link>
      <div className="grid md:grid-cols-3 gap-4">
        {[
          ['Admin', 'Runs the company: people, clients, projects, and billing.'],
          ['Employee', 'Sees only coworkers and work inside that company.'],
          ['Client', 'Sees only the work that company shares with them.'],
        ].map(([title, copy]) => (
          <article key={title} className="bg-white border border-line rounded-2xl p-5">
            <h2 className="font-semibold">{title}</h2>
            <p className="text-sm text-muted mt-2">{copy}</p>
          </article>
        ))}
      </div>
    </main>
  )
}
