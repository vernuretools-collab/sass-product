import React, { useState, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { PageHeader } from '../../components/layout/PageHeader'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { useUserStore } from '../../stores/userStore'
import { useMarketingStore } from './stores/marketingStore'
import {
  getCampaigns,
  createCampaign,
  updateCampaignInDb,
  deleteCampaignFromDb,
} from './services/marketingService'
import {
  Megaphone,
  Plus,
  Search,
  IndianRupee,
  Users,
  Target,
  Calendar,
  Link as LinkIcon,
  X,
  Trash2,
  Edit2,
  AlertTriangle,
} from 'lucide-react'

export const CampaignList = () => {
  const { claims } = useUserStore()
  const orgId = claims?.orgId || ''

  const { campaigns, addCampaign, updateCampaign, deleteCampaign, setCampaigns } = useMarketingStore()

  const [searchQuery, setSearchQuery] = useState('')
  const [channelFilter, setChannelFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')

  const [showAddModal, setShowAddModal] = useState(false)
  const [editingCampaign, setEditingCampaign] = useState(null)
  const [deletingId, setDeletingId] = useState(null)

  // Add Form state
  const [name, setName] = useState('')
  const [channel, setChannel] = useState('LinkedIn Ads')
  const [budget, setBudget] = useState('')
  const [utmSource, setUtmSource] = useState('linkedin')
  const [utmMedium, setUtmMedium] = useState('cpc')
  const [utmCampaign, setUtmCampaign] = useState('')

  // Edit Form state
  const [editName, setEditName] = useState('')
  const [editChannel, setEditChannel] = useState('')
  const [editBudget, setEditBudget] = useState('')
  const [editSpent, setEditSpent] = useState('')
  const [editLeads, setEditLeads] = useState('')
  const [editConversionRate, setEditConversionRate] = useState('')
  const [editStatus, setEditStatus] = useState('active')
  const [editUtmSource, setEditUtmSource] = useState('')
  const [editUtmMedium, setEditUtmMedium] = useState('')
  const [editUtmCampaign, setEditUtmCampaign] = useState('')

  useEffect(() => {
    const fetchRealCampaigns = async () => {
      const data = await getCampaigns(orgId)
      if (data) {
        setCampaigns(data)
      }
    }
    fetchRealCampaigns()
  }, [orgId, setCampaigns])

  const filtered = campaigns.filter((c) => {
    const q = searchQuery.toLowerCase().trim()
    const matchesQuery =
      !q ||
      (c.name && c.name.toLowerCase().includes(q)) ||
      (c.channel && c.channel.toLowerCase().includes(q)) ||
      (c.utmCampaign && c.utmCampaign.toLowerCase().includes(q))

    const matchesChannel = channelFilter === 'all' || c.channel === channelFilter
    const matchesStatus = statusFilter === 'all' || c.status === statusFilter

    return matchesQuery && matchesChannel && matchesStatus
  })

  // Summary Metrics
  const totalSpend = campaigns.reduce((sum, c) => sum + (Number(c.spent) || 0), 0)
  const totalLeads = campaigns.reduce((sum, c) => sum + (Number(c.leadsGenerated) || 0), 0)
  const avgCostPerLead = totalLeads > 0 ? Math.round(totalSpend / totalLeads) : 0

  const handleCreateCampaign = async (e) => {
    e.preventDefault()
    if (!name.trim()) return

    const payload = {
      name,
      channel,
      budget: Number(budget) || 0,
      spent: 0,
      leadsGenerated: 0,
      conversionRate: 0,
      status: 'active',
      startDate: new Date().toISOString().split('T')[0],
      utmSource: utmSource || 'direct',
      utmMedium: utmMedium || 'cpc',
      utmCampaign: utmCampaign || name.toLowerCase().replace(/\s+/g, '_'),
    }

    const created = await createCampaign(payload, orgId)
    addCampaign(created)

    setName('')
    setBudget('')
    setUtmCampaign('')
    setShowAddModal(false)
  }

  const openEditModal = (c) => {
    setEditingCampaign(c)
    setEditName(c.name || '')
    setEditChannel(c.channel || 'LinkedIn Ads')
    setEditBudget(c.budget || 0)
    setEditSpent(c.spent || 0)
    setEditLeads(c.leadsGenerated || 0)
    setEditConversionRate(c.conversionRate || 0)
    setEditStatus(c.status || 'active')
    setEditUtmSource(c.utmSource || 'linkedin')
    setEditUtmMedium(c.utmMedium || 'cpc')
    setEditUtmCampaign(c.utmCampaign || '')
  }

  const handleUpdateCampaign = async (e) => {
    e.preventDefault()
    if (!editingCampaign || !editName.trim()) return

    const updatedFields = {
      name: editName,
      channel: editChannel,
      budget: Number(editBudget) || 0,
      spent: Number(editSpent) || 0,
      leadsGenerated: Number(editLeads) || 0,
      conversionRate: Number(editConversionRate) || 0,
      status: editStatus,
      utmSource: editUtmSource,
      utmMedium: editUtmMedium,
      utmCampaign: editUtmCampaign,
    }

    updateCampaign(editingCampaign.campaignId, updatedFields)
    await updateCampaignInDb(editingCampaign.campaignId, updatedFields, orgId)

    setEditingCampaign(null)
  }

  const confirmDeleteCampaign = async () => {
    if (!deletingId) return
    deleteCampaign(deletingId)
    await deleteCampaignFromDb(deletingId, orgId)
    setDeletingId(null)
  }

  const getStatusBadgeVariant = (status) => {
    switch (status) {
      case 'active':
        return 'success'
      case 'paused':
        return 'warning'
      case 'completed':
        return 'neutral'
      default:
        return 'primary'
    }
  }

  return (
    <div className="space-y-6">
      {/* Header & Navigation Tabs */}
      <div className="space-y-4">
        <PageHeader
          title="Marketing & Acquisition Hub"
          description="Track paid performance, manage content distribution, build UTM campaign URLs, and analyze cost per lead."
          actions={
            <Button icon={Plus} variant="primary" onClick={() => setShowAddModal(true)}>
              New Campaign
            </Button>
          }
        />

        <div className="flex items-center gap-2 border-b border-border pb-3">
          <NavLink
            to="/marketing/campaigns"
            className={({ isActive }) =>
              `flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors ${
                isActive
                  ? 'bg-accent-soft text-accent border border-accent/30'
                  : 'text-muted hover:text-fg hover:bg-slate-100 dark:hover:bg-slate-800'
              }`
            }
          >
            <Megaphone className="w-3.5 h-3.5" /> Campaigns
          </NavLink>
          <NavLink
            to="/marketing/content"
            className={({ isActive }) =>
              `flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors ${
                isActive
                  ? 'bg-accent-soft text-accent border border-accent/30'
                  : 'text-muted hover:text-fg hover:bg-slate-100 dark:hover:bg-slate-800'
              }`
            }
          >
            <Calendar className="w-3.5 h-3.5" /> Content Calendar
          </NavLink>
          <NavLink
            to="/marketing/utm-builder"
            className={({ isActive }) =>
              `flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors ${
                isActive
                  ? 'bg-accent-soft text-accent border border-accent/30'
                  : 'text-muted hover:text-fg hover:bg-slate-100 dark:hover:bg-slate-800'
              }`
            }
          >
            <LinkIcon className="w-3.5 h-3.5" /> UTM Link Builder
          </NavLink>
        </div>
      </div>

      {/* Metrics Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-4 flex items-center justify-between border-border bg-surface">
          <div>
            <span className="text-[11px] font-medium text-muted uppercase tracking-wider">
              Total Marketing Spend
            </span>
            <p className="text-2xl font-bold text-fg mt-1">
              ₹{totalSpend.toLocaleString('en-IN')}
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-accent-soft text-accent flex items-center justify-center">
            <IndianRupee className="w-5 h-5" />
          </div>
        </Card>

        <Card className="p-4 flex items-center justify-between border-border bg-surface">
          <div>
            <span className="text-[11px] font-medium text-muted uppercase tracking-wider">
              Leads Acquired
            </span>
            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">{totalLeads} Leads</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
            <Users className="w-5 h-5" />
          </div>
        </Card>

        <Card className="p-4 flex items-center justify-between border-border bg-surface">
          <div>
            <span className="text-[11px] font-medium text-muted uppercase tracking-wider">
              Avg Cost Per Lead
            </span>
            <p className="text-2xl font-bold text-purple-600 dark:text-purple-400 mt-1">
              ₹{avgCostPerLead.toLocaleString('en-IN')} <span className="text-xs font-normal text-muted">/ lead</span>
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center">
            <Target className="w-5 h-5" />
          </div>
        </Card>
      </div>

      {/* Search & Filter Bar */}
      <Card className="p-3 border-border bg-surface">
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search campaigns by name, channel, or UTM parameter..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-canvas border border-border text-fg text-xs rounded-xl pl-9 pr-3.5 py-2.5 focus:outline-none focus:border-accent"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <select
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
              className="bg-canvas border border-border text-fg text-xs rounded-xl px-3 py-2.5 focus:outline-none cursor-pointer"
            >
              <option value="all">All Channels</option>
              <option value="LinkedIn Ads">LinkedIn Ads</option>
              <option value="Google Search Ads">Google Search Ads</option>
              <option value="Organic Content & SEO">Organic Content & SEO</option>
              <option value="Email Newsletter">Email Newsletter</option>
              <option value="Event / Conference">Event / Conference</option>
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-canvas border border-border text-fg text-xs rounded-xl px-3 py-2.5 focus:outline-none cursor-pointer"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="completed">Completed</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Campaigns Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filtered.map((c) => {
          const spent = Number(c.spent) || 0
          const budget = Number(c.budget) || 1
          const pct = Math.min(100, Math.round((spent / budget) * 100))

          return (
            <Card key={c.campaignId} hover className="space-y-3.5 border-border bg-surface flex flex-col justify-between">
              <div className="space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-bold text-fg text-sm leading-snug">{c.name}</h4>
                    <p className="text-xs font-medium text-accent mt-0.5">{c.channel}</p>
                  </div>
                  <Badge variant={getStatusBadgeVariant(c.status)}>{c.status}</Badge>
                </div>

                {/* Budget Progress */}
                <div className="space-y-1.5 text-xs text-muted">
                  <div className="flex justify-between items-center text-[11px]">
                    <span>Spend vs Budget</span>
                    <span className="font-semibold text-fg">
                      ₹{spent.toLocaleString('en-IN')} / ₹{budget.toLocaleString('en-IN')}
                    </span>
                  </div>
                  <div className="w-full bg-canvas h-2 rounded-full overflow-hidden border border-border">
                    <div
                      className={`h-full transition-all duration-300 ${
                        pct > 90 ? 'bg-rose-500' : pct > 70 ? 'bg-amber-500' : 'bg-accent dark:bg-accent'
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 dark:border-border text-xs">
                  <div className="p-2.5 rounded-xl bg-canvas border border-slate-200/60 dark:border-border">
                    <span className="text-[10px] text-muted block font-medium">Leads</span>
                    <span className="font-bold text-emerald-600 dark:text-emerald-400 text-base">{c.leadsGenerated || 0}</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-canvas border border-slate-200/60 dark:border-border">
                    <span className="text-[10px] text-muted block font-medium">Conversion Rate</span>
                    <span className="font-bold text-purple-600 dark:text-purple-400 text-base">{c.conversionRate || 0}%</span>
                  </div>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-between text-[11px] text-muted border-t border-slate-100 dark:border-border">
                <span className="font-mono text-muted truncate max-w-[170px]" title={c.utmCampaign}>
                  utm_campaign={c.utmCampaign || 'n/a'}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => openEditModal(c)}
                    className="p-1.5 text-slate-400 hover:text-accent dark:hover:text-accent rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    title="Edit Campaign"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setDeletingId(c.campaignId)}
                    className="p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    title="Delete Campaign"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </Card>
          )
        })}

        {filtered.length === 0 && (
          <div className="col-span-full p-8 text-center text-muted bg-surface rounded-2xl border border-border">
            No marketing campaigns match your criteria. Click "New Campaign" to create one.
          </div>
        )}
      </div>

      {/* Create Campaign Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="w-full max-w-lg p-6 space-y-4 border-border shadow-2xl relative bg-surface">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h3 className="font-bold text-fg text-sm">Create Marketing Campaign</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateCampaign} className="space-y-4">
              <Input
                label="Campaign Title"
                placeholder="e.g. Q4 Growth Sprint"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5 text-left">
                  <label className="block text-xs font-medium text-fg">Channel</label>
                  <select
                    value={channel}
                    onChange={(e) => setChannel(e.target.value)}
                    className="w-full bg-canvas border border-border text-fg text-xs rounded-xl py-2.5 px-3.5 focus:outline-none focus:border-accent cursor-pointer"
                  >
                    <option value="LinkedIn Ads">LinkedIn Ads</option>
                    <option value="Google Search Ads">Google Search Ads</option>
                    <option value="Organic Content & SEO">Organic Content & SEO</option>
                    <option value="Email Newsletter">Email Newsletter</option>
                    <option value="Event / Conference">Event / Conference</option>
                  </select>
                </div>

                <Input
                  label="Budget (₹ INR)"
                  type="number"
                  placeholder="50000"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <Input
                  label="UTM Source"
                  placeholder="linkedin"
                  value={utmSource}
                  onChange={(e) => setUtmSource(e.target.value)}
                />
                <Input
                  label="UTM Medium"
                  placeholder="cpc"
                  value={utmMedium}
                  onChange={(e) => setUtmMedium(e.target.value)}
                />
                <Input
                  label="UTM Campaign"
                  placeholder="q4_growth"
                  value={utmCampaign}
                  onChange={(e) => setUtmCampaign(e.target.value)}
                />
              </div>

              <div className="flex gap-3 pt-2">
                <Button type="button" variant="secondary" onClick={() => setShowAddModal(false)} className="w-1/3">
                  Cancel
                </Button>
                <Button type="submit" variant="primary" className="w-2/3" icon={Plus}>
                  Save Campaign
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Edit Campaign Modal */}
      {editingCampaign && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="w-full max-w-lg p-6 space-y-4 border-border shadow-2xl relative bg-surface">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h3 className="font-bold text-fg text-sm">Edit Marketing Campaign</h3>
              <button
                onClick={() => setEditingCampaign(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUpdateCampaign} className="space-y-4">
              <Input
                label="Campaign Title"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                required
              />

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5 text-left">
                  <label className="block text-xs font-medium text-fg">Channel</label>
                  <select
                    value={editChannel}
                    onChange={(e) => setEditChannel(e.target.value)}
                    className="w-full bg-canvas border border-border text-fg text-xs rounded-xl py-2.5 px-3.5 focus:outline-none cursor-pointer"
                  >
                    <option value="LinkedIn Ads">LinkedIn Ads</option>
                    <option value="Google Search Ads">Google Search Ads</option>
                    <option value="Organic Content & SEO">Organic Content & SEO</option>
                    <option value="Email Newsletter">Email Newsletter</option>
                    <option value="Event / Conference">Event / Conference</option>
                  </select>
                </div>

                <div className="space-y-1.5 text-left">
                  <label className="block text-xs font-medium text-fg">Status</label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value)}
                    className="w-full bg-canvas border border-border text-fg text-xs rounded-xl py-2.5 px-3.5 focus:outline-none cursor-pointer"
                  >
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                    <option value="completed">Completed</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Budget (₹ INR)"
                  type="number"
                  value={editBudget}
                  onChange={(e) => setEditBudget(e.target.value)}
                />
                <Input
                  label="Total Spent (₹ INR)"
                  type="number"
                  value={editSpent}
                  onChange={(e) => setEditSpent(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Leads Generated"
                  type="number"
                  value={editLeads}
                  onChange={(e) => setEditLeads(e.target.value)}
                />
                <Input
                  label="Conversion Rate (%)"
                  type="number"
                  step="0.1"
                  value={editConversionRate}
                  onChange={(e) => setEditConversionRate(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <Input
                  label="UTM Source"
                  value={editUtmSource}
                  onChange={(e) => setEditUtmSource(e.target.value)}
                />
                <Input
                  label="UTM Medium"
                  value={editUtmMedium}
                  onChange={(e) => setEditUtmMedium(e.target.value)}
                />
                <Input
                  label="UTM Campaign"
                  value={editUtmCampaign}
                  onChange={(e) => setEditUtmCampaign(e.target.value)}
                />
              </div>

              <div className="flex gap-3 pt-2">
                <Button type="button" variant="secondary" onClick={() => setEditingCampaign(null)} className="w-1/3">
                  Cancel
                </Button>
                <Button type="submit" variant="primary" className="w-2/3">
                  Update Campaign
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingId && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="w-full max-w-sm p-6 space-y-4 border-border shadow-2xl relative bg-surface text-center">
            <div className="w-12 h-12 rounded-full bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 mx-auto flex items-center justify-center">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-bold text-fg text-sm">Delete Campaign?</h3>
              <p className="text-xs text-muted mt-1">
                Are you sure you want to delete this campaign? This action cannot be undone.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setDeletingId(null)} className="w-1/2">
                Cancel
              </Button>
              <Button variant="danger" onClick={confirmDeleteCampaign} className="w-1/2">
                Delete
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
