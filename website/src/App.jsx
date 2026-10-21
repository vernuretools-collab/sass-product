import { Link, NavLink, Route, Routes } from 'react-router-dom'
import { BuyPage } from './pages/BuyPage'
import { HomePage } from './pages/HomePage'
import { ProductPage } from './pages/ProductPage'
import { CompaniesPage } from './pages/CompaniesPage'
import { SuccessPage } from './pages/SuccessPage'

const linkClass = ({ isActive }) =>
  `text-sm ${isActive ? 'text-accent font-semibold' : 'text-muted'}`

export function App() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-white">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <NavLink to="/" className="font-semibold tracking-tight">Business OS</NavLink>
          <nav className="flex items-center gap-5">
            <NavLink to="/" className={linkClass} end>Home</NavLink>
            <NavLink to="/product" className={linkClass}>Product</NavLink>
            <NavLink to="/companies" className={linkClass}>Companies</NavLink>
            <Link to="/buy" className="text-sm rounded-xl bg-accent text-white px-3 py-2 font-medium">Buy</Link>
          </nav>
        </div>
      </header>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/product" element={<ProductPage />} />
        <Route path="/companies" element={<CompaniesPage />} />
        <Route path="/buy" element={<BuyPage />} />
        <Route path="/buy/success" element={<SuccessPage />} />
      </Routes>
    </div>
  )
}
