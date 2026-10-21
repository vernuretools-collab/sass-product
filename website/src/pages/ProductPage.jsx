import { Link } from 'react-router-dom'

const portals = [
  {
    title: 'Admin',
    points: [
      'Owns the company workspace after you open it.',
      'Adds employees and clients inside that circle only.',
      'Cannot see another company’s people or projects.',
    ],
  },
  {
    title: 'Employee',
    points: [
      'Signs in with the account their company admin creates.',
      'Works with teammates in the same company.',
      'Has no access to other companies.',
    ],
  },
  {
    title: 'Client',
    points: [
      'Uses a login issued by their company admin.',
      'Sees their own company relationship, not the staff directory.',
      'Stays inside the circle you assigned to that company.',
    ],
  },
]

export function ProductPage() {
  return (
    <main className="max-w-5xl mx-auto px-4 py-16 space-y-8">
      <h1 className="text-4xl font-semibold">Three apps, one company circle</h1>
      <p className="text-muted max-w-2xl">
        The product you sell is the same admin, employee, and client software. Isolation is the company circle, not a separate copy of the app for every customer.
      </p>
      <Link to="/buy" className="inline-flex rounded-xl bg-accent text-white px-4 py-2.5 font-medium">Buy a workspace</Link>
      <div className="grid md:grid-cols-3 gap-4">
        {portals.map((portal) => (
          <article key={portal.title} className="bg-white border border-line rounded-2xl p-5">
            <h2 className="text-xl font-semibold">{portal.title}</h2>
            <ul className="mt-3 space-y-2 text-sm text-muted list-disc pl-4">
              {portal.points.map((point) => <li key={point}>{point}</li>)}
            </ul>
          </article>
        ))}
      </div>
    </main>
  )
}
