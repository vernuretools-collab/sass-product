import React, { useState, useEffect } from 'react'
import { NavLink, Link } from 'react-router-dom'
import { PageHeader } from '../../components/layout/PageHeader'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { useCRMStore } from './stores/crmStore'
import { getClientsFromDb } from './services/clientService'
import { createClientAccount, deleteClientAccount } from '../../shared/services/authService'
import { clientDisplayName, clientLoginLabel, isValidClientUsername, normalizeClientUsername } from '../../../../shared/supabase/clientLogin.js'
import {
  Kanban,
  List,
  Contact,
  UserPlus,
  User,
  Mail,
  Phone,
  Building,
  X,
  Plus,
  ExternalLink,
  Shield,
  Search,
  FileSignature,
  Trash2
} from 'lucide-react'

export const ContactList = () => {
  const { leads, addLead } = useCRMStore()
  const [activeTab, setActiveTab] = useState('clients') // 'clients' or 'leads'
  const [searchQuery, setSearchQuery] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [clientAccounts, setClientAccounts] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  // Login-only create — GST, address and billing are filled on Manage Profile
  const EMPTY_FORM = {
    username: '',
    password: '',
    phone: '',
    signatoryTitle: '',
  }
  const [form, setForm] = useState(EMPTY_FORM)

  const setField = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))

  const fetchClients = async () => {
    const data = await getClientsFromDb()
    setClientAccounts(data)
  }

  useEffect(() => {
    fetchClients()
  }, [])

  const confirmDeleteClient = async () => {
    if (!pendingDelete?.uid) return
    const target = pendingDelete
    setClientAccounts((rows) => rows.filter((c) => c.uid !== target.uid))
    setPendingDelete(null)
    setDeleteError('')
    try {
      await deleteClientAccount(target.uid)
    } catch (err) {
      setDeleteError(err.message || 'Could not delete this account.')
      setPendingDelete(target)
      await fetchClients()
    }
  }

  // Extract contacts from leads store
  const leadContacts = leads.map((l) => ({
    id: l.leadId,
    name: l.contactName,
    company: l.companyName,
    email: l.email || '',
    phone: l.phone || '',
    dealName: l.name,
  }))

  const handleCreateClient = async (e) => {
    e.preventDefault()

    const required = [
      ['username', 'Username'],
      ['password', 'Account Password'],
    ]
    const missing = required.filter(([key]) => !form[key].trim()).map(([, label]) => label)
    if (missing.length) {
      setError(`Please fill in: ${missing.join(', ')}.`)
      return
    }

    const displayName = clientDisplayName(form.username)
    const username = normalizeClientUsername(displayName)
    if (!isValidClientUsername(username)) {
      setError('Name must be 3–32 characters. Letters, numbers, dots, hyphens, and underscores are allowed, and spaces are kept in the name.')
      return
    }

    if (form.password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    const draft = { ...form }
    const pendingId = `pending-${Date.now()}`
    setClientAccounts((rows) => [{
      uid: pendingId,
      displayName,
      companyName: displayName,
      username,
      phoneNumber: draft.phone.trim() || null,
      status: 'active',
    }, ...rows])
    setShowAddModal(false)
    setForm(EMPTY_FORM)
    setError('')
    setSuccess('')

    try {
      const clientUser = await createClientAccount({
        username,
        password: draft.password,
        displayName,
        companyName: displayName,
        phone: draft.phone.trim(),
        billingEmail: '',
        billingAddress: '',
        taxId: '',
        paymentMethod: 'ach',
        signerPhone: draft.phone.trim(),
        signatoryTitle: draft.signatoryTitle.trim(),
        dealName: '',
      })

      addLead({
        name: `${displayName} Account`,
        companyName: displayName,
        contactName: displayName,
        email: '',
        phone: draft.phone.trim(),
        estimatedValue: 25000,
        pipelineStageId: 'stage_won',
        pipelineStage: 'Won',
        ownerName: 'Admin Executive',
        clientId: clientUser.uid
      })
      fetchClients()
    } catch (err) {
      console.error(err)
      setClientAccounts((rows) => rows.filter((row) => row.uid !== pendingId))
      setForm(draft)
      setShowAddModal(true)
      setError(err.message || 'Failed to create client account.')
    }
  }

  // Filters
  const filteredClients = clientAccounts.filter((c) => {
    const q = searchQuery.toLowerCase()
    return (
      !q ||
      c.displayName?.toLowerCase().includes(q) ||
      c.companyName?.toLowerCase().includes(q) ||
      c.username?.toLowerCase().includes(q) ||
      clientLoginLabel(c).toLowerCase().includes(q)
    )
  })

  const filteredLeadContacts = leadContacts.filter((c) => {
    const q = searchQuery.toLowerCase()
    return (
      !q ||
      c.name?.toLowerCase().includes(q) ||
      c.company?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q)
    )
  })

  return (
    <div className="space-y-6">
      {/* Header & Sub-Nav */}
      <div className="space-y-4">
        <PageHeader
          title="Contacts & Client Directory"
          description="Directory of individual client contacts, portal accounts, and key decision makers"
          actions={
            <Button icon={UserPlus} variant="primary" onClick={() => setShowAddModal(true)}>
              Register Client Portal User
            </Button>
          }
        />

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <NavLink
              to="/crm/pipeline"
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                  isActive
                    ? 'bg-accent-soft text-accent border border-accent/30'
                    : 'text-muted hover:text-fg hover:bg-slate-100 dark:hover:bg-slate-800'
                }`
              }
            >
              <Kanban className="w-3.5 h-3.5" /> Pipeline Board
            </NavLink>
            <NavLink
              to="/crm/leads"
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                  isActive
                    ? 'bg-accent-soft text-accent border border-accent/30'
                    : 'text-muted hover:text-fg hover:bg-slate-100 dark:hover:bg-slate-800'
                }`
              }
            >
              <List className="w-3.5 h-3.5" /> All Leads Directory
            </NavLink>
            <NavLink
              to="/crm/contacts"
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                  isActive
                    ? 'bg-accent-soft text-accent border border-accent/30'
                    : 'text-muted hover:text-fg hover:bg-slate-100 dark:hover:bg-slate-800'
                }`
              }
            >
              <Contact className="w-3.5 h-3.5" /> Contacts Directory
            </NavLink>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search directory..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-1.5 rounded-xl text-xs bg-canvas border border-border focus:outline-none focus:border-accent text-slate-800 dark:text-fg"
            />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b border-border">
        <button
          onClick={() => setActiveTab('clients')}
          className={`pb-2.5 text-xs font-bold transition-all relative border-b-2 ${
            activeTab === 'clients'
              ? 'border-accent text-accent font-bold'
              : 'border-transparent text-muted hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          Client Portal Users ({filteredClients.length})
        </button>
        <button
          onClick={() => setActiveTab('leads')}
          className={`pb-2.5 text-xs font-bold transition-all relative border-b-2 ${
            activeTab === 'leads'
              ? 'border-accent text-accent font-bold'
              : 'border-transparent text-muted hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          Sales Leads Contacts ({filteredLeadContacts.length})
        </button>
      </div>

      {/* Grid of Cards */}
      {activeTab === 'clients' ? (
        filteredClients.length === 0 ? (
          <div className="py-12 text-center text-muted text-xs">
            No registered client portal accounts found. Click "Register Client Portal User" to create one.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredClients.map((c) => (
              <Card key={c.uid} hover className="space-y-3 border-border bg-surface flex flex-col justify-between">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-600/20 text-emerald-600 dark:text-emerald-400 font-bold flex items-center justify-center border border-emerald-200 dark:border-emerald-500/30">
                        {c.displayName?.charAt(0) || 'C'}
                      </div>
                      <div>
                        <h4 className="font-bold text-fg text-sm">{c.displayName}</h4>
                        <p className="text-xs text-muted flex items-center gap-1">
                          <Building className="w-3 h-3 text-muted" /> {c.companyName}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteError('')
                        setPendingDelete(c)
                      }}
                      className="shrink-0 p-1.5 rounded-lg text-rose-500 hover:bg-rose-500/10 transition-colors"
                      aria-label={`Delete ${c.displayName || 'client'}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="space-y-1.5 pt-2 border-t border-border/60 text-xs text-fg">
                    <div className="flex items-center gap-2 text-muted">
                      <User className="w-3.5 h-3.5 text-muted" />
                      <span className="truncate">{clientLoginLabel(c)}</span>
                    </div>
                    {c.phoneNumber && (
                      <div className="flex items-center gap-2 text-muted">
                        <Phone className="w-3.5 h-3.5 text-muted" />
                        <span>{c.phoneNumber}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 dark:border-border/60 flex items-center justify-between gap-2 mt-2">
                  <Badge variant="success">Active Account</Badge>
                  <Link
                    to={`/crm/client/${c.uid}`}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-accent hover:text-accent dark:hover:text-accent transition-colors"
                  >
                    Manage Profile <ExternalLink className="w-3 h-3" />
                  </Link>
                </div>
              </Card>
            ))}
          </div>
        )
      ) : (
        filteredLeadContacts.length === 0 ? (
          <div className="py-12 text-center text-muted text-xs">
            No sales leads contacts found.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredLeadContacts.map((c) => (
              <Card key={c.id} hover className="space-y-3 border-border bg-surface">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-accent-soft text-accent font-bold flex items-center justify-center border border-accent/30">
                    {c.name?.charAt(0) || 'C'}
                  </div>
                  <div>
                    <h4 className="font-bold text-fg text-sm">{c.name}</h4>
                    <p className="text-xs text-muted flex items-center gap-1">
                      <Building className="w-3 h-3 text-muted" /> {c.company}
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5 pt-2 border-t border-border/60 text-xs text-fg">
                  {c.email ? (
                    <div className="flex items-center gap-2 text-muted">
                      <Mail className="w-3.5 h-3.5 text-muted" />
                      <span className="truncate">{c.email}</span>
                    </div>
                  ) : null}
                  <div className="flex items-center gap-2 text-muted">
                    <Phone className="w-3.5 h-3.5 text-muted" />
                    <span>{c.phone}</span>
                  </div>
                </div>

                <div className="pt-2 flex justify-between items-center text-[11px] text-muted">
                  <span>Linked Opportunity:</span>
                  <Badge variant="neutral">{c.dealName}</Badge>
                </div>
              </Card>
            ))}
          </div>
        )
      )}

      {pendingDelete && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="w-full max-w-md p-6 space-y-4 border-border shadow-2xl bg-surface">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-bold text-fg text-sm">Delete this client account?</h3>
                <p className="text-[11px] text-muted mt-1">
                  {pendingDelete.displayName || 'This user'} ({clientLoginLabel(pendingDelete)}) will be removed and will no longer be able to sign in.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                disabled={deleting}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {deleteError && (
              <div className="p-3 text-xs bg-rose-500/10 text-rose-500 rounded-xl border border-rose-500/20">
                {deleteError}
              </div>
            )}
            <div className="flex gap-3">
              <Button type="button" variant="secondary" className="w-1/3" onClick={() => setPendingDelete(null)} disabled={deleting}>
                Cancel
              </Button>
              <button
                type="button"
                onClick={confirmDeleteClient}
                disabled={deleting}
                className="w-2/3 px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 text-white hover:bg-rose-500 disabled:opacity-60"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </Card>
        </div>
      )}

      {/* Add Client Account Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-4 border-border shadow-2xl relative bg-surface">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div>
                <h3 className="font-bold text-fg text-sm">Register Client Portal User</h3>
                <p className="text-[11px] text-muted mt-0.5">
                  Create a username and password. Add GST, address and billing anytime on Manage Profile.
                </p>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {error && (
              <div className="p-3 text-xs bg-rose-500/10 text-rose-500 rounded-xl border border-rose-500/20">
                {error}
              </div>
            )}

            {success && (
              <div className="p-3 text-xs bg-emerald-500/10 text-emerald-500 rounded-xl border border-emerald-500/20">
                {success}
              </div>
            )}

            <form onSubmit={handleCreateClient} className="space-y-5">
              <fieldset className="space-y-3">
                <legend className="text-[10px] font-bold uppercase tracking-wider text-accent mb-2">
                  Account &amp; Login
                </legend>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input
                    label="Client Name *"
                    type="text"
                    placeholder="e.g. Vivek Anna"
                    autoComplete="off"
                    value={form.username}
                    onChange={setField('username')}
                    required
                  />
                  <Input
                    label="Phone Number"
                    placeholder="+1 (555) 019-2834"
                    value={form.phone}
                    onChange={setField('phone')}
                  />
                </div>

                <Input
                  label="Signatory Designation"
                  placeholder="e.g. Director of Operations"
                  value={form.signatoryTitle}
                  onChange={setField('signatoryTitle')}
                />

                <Input
                    label="Set Account Password *"
                    type="password"
                    placeholder="Minimum 8 characters"
                    value={form.password}
                    onChange={setField('password')}
                    required
                  />
              </fieldset>

              <div className="p-3 text-[11px] bg-accent-soft text-accent rounded-xl border border-accent/20 flex items-start gap-2">
                <FileSignature className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  GST, registered address and billing details are added on Manage Profile after the account exists.
                  Agreement wording can be tailored there before the client signs.
                </span>
              </div>

              <div className="flex gap-3 pt-1">
                <Button type="button" variant="secondary" onClick={() => setShowAddModal(false)} className="w-1/3" disabled={loading}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" className="w-2/3 bg-accent hover:bg-accent-hover" icon={Plus} disabled={loading}>
                  {loading ? 'Registering Account...' : 'Create Client Account'}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  )
}
