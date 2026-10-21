import React, { useState, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { PageHeader } from '../../components/layout/PageHeader'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { useCRMStore } from './stores/crmStore'
import { getLeads, createLead, updateLeadStageInDb, deleteLeadFromDb, getCrmStagesFromDb, createCrmStageInDb } from './services/crmService'
import {
  Plus,
  Search,
  IndianRupee,
  User,
  Building,
  Mail,
  Phone,
  Tag,
  ArrowRight,
  Trash2,
  SlidersHorizontal,
  TrendingUp,
  Award,
  Layers,
  X,
  ChevronRight,
  Kanban,
  List,
  Contact
} from 'lucide-react'

const STAGE_DOT_COLORS = {
  stage_new: 'bg-sky-500 dark:bg-sky-400',
  stage_contacted: 'bg-accent',
  stage_qualified: 'bg-purple-500 dark:bg-purple-400',
  stage_proposal: 'bg-amber-500 dark:bg-amber-400',
  stage_negotiation: 'bg-orange-500 dark:bg-orange-400',
  stage_won: 'bg-emerald-500 dark:bg-emerald-400',
  stage_lost: 'bg-rose-500 dark:bg-rose-400',
  blue: 'bg-sky-500 dark:bg-sky-400',
  sky: 'bg-sky-500 dark:bg-sky-400',
  indigo: 'bg-accent',
  purple: 'bg-purple-500 dark:bg-purple-400',
  amber: 'bg-amber-500 dark:bg-amber-400',
  orange: 'bg-orange-500 dark:bg-orange-400',
  emerald: 'bg-emerald-500 dark:bg-emerald-400',
  rose: 'bg-rose-500 dark:bg-rose-400',
}

const getStageDotBg = (stage) => {
  if (!stage) return 'bg-sky-500 dark:bg-sky-400'
  if (typeof stage === 'string') return STAGE_DOT_COLORS[stage] || 'bg-sky-500 dark:bg-sky-400'
  return (
    STAGE_DOT_COLORS[stage.id] ||
    STAGE_DOT_COLORS[stage.color] ||
    'bg-sky-500 dark:bg-sky-400'
  )
}

export const Pipeline = () => {
  const {
    leads,
    stages,
    setLeads,
    addCustomStage,
    addLead,
    updateLeadStage,
    deleteLead,
    searchQuery,
    setSearchQuery,
  } = useCRMStore()

  const [showAddModal, setShowAddModal] = useState(false)
  const [showAddStageModal, setShowAddStageModal] = useState(false)
  const [newStageName, setNewStageName] = useState('')
  const [newStageColor, setNewStageColor] = useState('indigo')
  const [selectedLead, setSelectedLead] = useState(null)
  const [deleteConfirmLead, setDeleteConfirmLead] = useState(null)
  const [loadingDb, setLoadingDb] = useState(false)

  // Drag & Drop State for CRM Pipeline
  const [draggedOverStage, setDraggedOverStage] = useState(null)
  const [draggingLeadId, setDraggingLeadId] = useState(null)

  // Form State for Add Lead Modal
  const [newDealName, setNewDealName] = useState('')
  const [newCompanyName, setNewCompanyName] = useState('')
  const [newContactName, setNewContactName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newValue, setNewValue] = useState('')
  const [newStageId, setNewStageId] = useState('stage_new')

  // Fetch real leads & custom pipeline stages from Firestore on component mount
  useEffect(() => {
    const fetchData = async () => {
      setLoadingDb(true)
      const [data, customStages] = await Promise.all([
        getLeads(null),
        getCrmStagesFromDb(),
      ])
      if (data && data.length > 0) {
        setLeads(data)
      }
      if (customStages && customStages.length > 0) {
        customStages.forEach((cs) => addCustomStage(cs))
      }
      setLoadingDb(false)
    }
    fetchData()
  }, [setLeads, addCustomStage])

  // Drag & Drop Handlers
  const handleDragStart = (e, leadId) => {
    e.dataTransfer.setData('text/plain', leadId)
    e.dataTransfer.effectAllowed = 'move'
    setDraggingLeadId(leadId)
  }

  const handleDragEnd = () => {
    setDraggingLeadId(null)
    setDraggedOverStage(null)
  }

  const handleDragOver = (e, stageId) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (draggedOverStage !== stageId) {
      setDraggedOverStage(stageId)
    }
  }

  const handleDragLeave = (e, stageId) => {
    if (draggedOverStage === stageId) {
      setDraggedOverStage(null)
    }
  }

  const handleDrop = async (e, targetStageId) => {
    e.preventDefault()
    setDraggedOverStage(null)
    setDraggingLeadId(null)
    const leadId = e.dataTransfer.getData('text/plain')
    if (!leadId) return

    const lead = leads.find((l) => l.leadId === leadId)
    const targetStageObj = stages.find((s) => s.id === targetStageId)
    if (lead && lead.pipelineStageId !== targetStageId && targetStageObj) {
      updateLeadStage(leadId, targetStageId, targetStageObj.name)
      await updateLeadStageInDb(null, leadId, targetStageId, targetStageObj.name)
    }
  }

  const handleAddCustomStage = async (e) => {
    e.preventDefault()
    if (!newStageName.trim()) return

    const newStageObj = {
      id: `stage_${Date.now()}`,
      name: newStageName.trim(),
      color: newStageColor,
    }

    addCustomStage(newStageObj)
    await createCrmStageInDb(newStageObj)

    setNewStageName('')
    setShowAddStageModal(false)
  }

  // Filter leads by search query
  const filteredLeads = leads.filter((l) => {
    const q = searchQuery.toLowerCase()
    return (
      !q ||
      (l.name && l.name.toLowerCase().includes(q)) ||
      (l.companyName && l.companyName.toLowerCase().includes(q)) ||
      (l.contactName && l.contactName.toLowerCase().includes(q))
    )
  })

  // Calculate Pipeline Metrics
  const totalPipelineValue = filteredLeads.reduce(
    (sum, l) => sum + (Number(l.estimatedValue) || 0),
    0
  )
  const wonCount = filteredLeads.filter((l) => l.pipelineStageId === 'stage_won').length
  const winRate =
    filteredLeads.length > 0
      ? Math.round((wonCount / filteredLeads.length) * 100)
      : 0
  const avgDealSize =
    filteredLeads.length > 0
      ? Math.round(totalPipelineValue / filteredLeads.length)
      : 0

  const handleCreateLead = async (e) => {
    e.preventDefault()
    if (!newDealName.trim()) return

    const stageObj = stages.find((s) => s.id === newStageId) || stages[0]

    const leadPayload = {
      name: newDealName,
      companyName: newCompanyName || 'Independent',
      contactName: newContactName || 'N/A',
      email: newEmail || null,
      estimatedValue: Number(newValue) || 0,
      pipelineStageId: stageObj.id,
      pipelineStage: stageObj.name,
      ownerName: 'Unassigned',
      score: 75,
      tags: ['New Lead'],
    }

    // Write to Firestore database collection
    const created = await createLead(null, leadPayload)

    // Update Zustand local store with returned document ID
    addLead(created)

    // Reset Form
    setNewDealName('')
    setNewCompanyName('')
    setNewContactName('')
    setNewEmail('')
    setNewValue('')
    setShowAddModal(false)
  }

  const handleStageChange = async (leadId, newStageId) => {
    const newStg = stages.find((s) => s.id === newStageId)
    if (!newStg) return

    updateLeadStage(leadId, newStg.id, newStg.name)
    await updateLeadStageInDb(null, leadId, newStg.id, newStg.name)
  }

  const handleDeleteLead = async (leadId) => {
    deleteLead(leadId)
    await deleteLeadFromDb(null, leadId)
  }

  return (
    <div className="space-y-6">
      {/* Top Header & Sub Nav */}
      <div className="space-y-4">
        <PageHeader
          title="Sales Pipeline & Deal Flow"
          description="Track opportunities, deal stages, pipeline metrics, and conversion rates"
          actions={
            <Button icon={Plus} variant="primary" onClick={() => setShowAddModal(true)}>
              New Lead
            </Button>
          }
        />

        {/* CRM Sub-Navigation Tabs */}
        <div className="flex items-center justify-between border-b border-border pb-3">
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

          {/* Search Bar */}
          <div className="relative w-64">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="text"
              placeholder="Search deals, contacts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-canvas border border-border text-xs text-fg placeholder:text-muted rounded-xl pl-8 pr-3 py-1.5 focus:outline-none focus:border-accent transition-colors"
            />
          </div>
        </div>
      </div>

      {/* Metrics Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 flex items-center justify-between border-border">
          <div>
            <span className="text-[11px] font-medium text-muted uppercase tracking-wider">
              Total Pipeline Value
            </span>
            <p className="text-xl font-bold text-fg mt-1">
              ₹{totalPipelineValue.toLocaleString('en-IN')}
            </p>
          </div>
          <div className="w-9 h-9 rounded-xl bg-accent-soft text-accent flex items-center justify-center">
            <IndianRupee className="w-5 h-5" />
          </div>
        </Card>

        <Card className="p-4 flex items-center justify-between border-border">
          <div>
            <span className="text-[11px] font-medium text-muted uppercase tracking-wider">
              Active Opportunities
            </span>
            <p className="text-xl font-bold text-fg mt-1">{filteredLeads.length}</p>
          </div>
          <div className="w-9 h-9 rounded-xl bg-info-soft text-info flex items-center justify-center">
            <Layers className="w-5 h-5" />
          </div>
        </Card>

        <Card className="p-4 flex items-center justify-between border-border">
          <div>
            <span className="text-[11px] font-medium text-muted uppercase tracking-wider">
              Win Rate
            </span>
            <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">{winRate}%</p>
          </div>
          <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
            <Award className="w-5 h-5" />
          </div>
        </Card>

        <Card className="p-4 flex items-center justify-between border-border">
          <div>
            <span className="text-[11px] font-medium text-muted uppercase tracking-wider">
              Average Deal Size
            </span>
            <p className="text-xl font-bold text-purple-600 dark:text-purple-400 mt-1">
              ₹{avgDealSize.toLocaleString('en-IN')}
            </p>
          </div>
          <div className="w-9 h-9 rounded-xl bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center">
            <TrendingUp className="w-5 h-5" />
          </div>
        </Card>
      </div>

      {/* Kanban Board Grid */}
      <div className="flex gap-4 overflow-x-auto pb-4 items-start min-h-[500px]">
        {stages.map((stage) => {
          const stageLeads = filteredLeads.filter(
            (l) => l.pipelineStageId === stage.id
          )
          const stageTotalValue = stageLeads.reduce(
            (sum, l) => sum + (Number(l.estimatedValue) || 0),
            0
          )

          return (
            <div
              key={stage.id}
              onDragOver={(e) => handleDragOver(e, stage.id)}
              onDragLeave={(e) => handleDragLeave(e, stage.id)}
              onDrop={(e) => handleDrop(e, stage.id)}
              className={`w-72 shrink-0 border rounded-2xl p-3 flex flex-col space-y-3 transition-all ${
                draggedOverStage === stage.id
                  ? 'bg-accent-soft border-accent/30 ring-2 ring-accent/40 shadow-lg'
                  : 'bg-canvas border-border/80'
              }`}
            >
              {/* Stage Column Header */}
              <div className="flex items-center justify-between px-1 pb-2 border-b border-border">
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full inline-block ${getStageDotBg(stage)}`} />
                  <span className="font-semibold text-fg text-xs">{stage.name}</span>
                  <Badge variant="brand">{stageLeads.length}</Badge>
                </div>
                <span className="text-[10px] font-bold text-muted">
                  ₹{stageTotalValue.toLocaleString('en-IN')}
                </span>
              </div>

              {/* Cards Container */}
              <div className="space-y-3 flex-1 overflow-y-auto max-h-[600px] pr-0.5">
                {stageLeads.length === 0 ? (
                  <div className="p-4 text-center border border-dashed border-border rounded-xl text-[11px] text-slate-400 dark:text-slate-600">
                    No deals in stage
                  </div>
                ) : (
                  stageLeads.map((lead) => (
                    <div
                      key={lead.leadId}
                      draggable
                      onDragStart={(e) => handleDragStart(e, lead.leadId)}
                      onDragEnd={handleDragEnd}
                      className={`transition-opacity cursor-grab active:cursor-grabbing ${
                        draggingLeadId === lead.leadId ? 'opacity-40 scale-95' : 'opacity-100'
                      }`}
                    >
                      <Card
                        hover
                        className="p-3.5 space-y-2.5 cursor-pointer bg-surface border-border hover:border-accent/40 relative group"
                        onClick={() => setSelectedLead(lead)}
                      >
                        <div className="flex items-start justify-between">
                          <span className="text-xs font-bold text-fg group-hover:text-accent dark:group-hover:text-accent transition-colors">
                            {lead.name}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <Badge
                              variant={
                                lead.score >= 85
                                  ? 'success'
                                  : lead.score >= 70
                                  ? 'info'
                                  : 'warning'
                              }
                            >
                              Score {lead.score || 70}
                            </Badge>
                            <button
                              type="button"
                              title="Delete Lead"
                              onClick={(e) => {
                                e.stopPropagation()
                                setDeleteConfirmLead(lead)
                              }}
                              className="text-muted hover:text-rose-500 dark:hover:text-rose-400 p-0.5 rounded transition-colors opacity-0 group-hover:opacity-100"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 text-[11px] text-muted">
                          <Building className="w-3 h-3 text-muted" />
                          <span className="truncate">{lead.companyName}</span>
                        </div>

                        <div className="flex items-center justify-between text-xs pt-2 border-t border-border/60">
                          <span className="font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5">
                            ₹{Number(lead.estimatedValue).toLocaleString('en-IN')}
                          </span>
                          <div className="flex items-center gap-1 text-[10px] text-muted">
                            <User className="w-3 h-3" /> {lead.ownerName}
                          </div>
                        </div>

                        {/* Move Stage Selector */}
                        <div
                          className="pt-2 flex items-center justify-between text-[10px] text-muted"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span>Move Stage:</span>
                          <select
                            value={lead.pipelineStageId}
                            onChange={(e) => handleStageChange(lead.leadId, e.target.value)}
                            className="bg-canvas border border-border text-[10px] text-fg rounded px-1.5 py-0.5 focus:outline-none cursor-pointer"
                          >
                            {stages.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </Card>
                    </div>
                  ))
                )}
              </div>
            </div>
          )
        })}

        {/* Sticky Floating + Add Stage Button (Pinned to Right Edge) */}
        <div className="sticky right-0 shrink-0 self-start z-10 pl-3 py-1 bg-gradient-to-l from-canvas via-canvas/90 to-transparent">
          <button
            type="button"
            onClick={() => setShowAddStageModal(true)}
            className="w-11 h-11 rounded-2xl bg-accent hover:bg-accent-hover text-white font-bold flex items-center justify-center shadow-lg shadow-accent/20 hover:scale-105 active:scale-95 transition-all cursor-pointer"
            title="Add Custom Pipeline Stage"
          >
            <Plus className="w-5 h-5 stroke-[2.5]" />
          </button>
        </div>
      </div>

      {/* Add Custom Stage Modal */}
      {showAddStageModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="w-full max-w-md p-6 space-y-4 border-border shadow-2xl relative bg-surface">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h3 className="font-bold text-fg text-sm">Add Custom Pipeline Stage</h3>
              <button
                onClick={() => setShowAddStageModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddCustomStage} className="space-y-4">
              <Input
                label="Stage Name"
                placeholder="e.g. Demo Scheduled"
                value={newStageName}
                onChange={(e) => setNewStageName(e.target.value)}
                required
              />

              <div className="space-y-1.5 text-left">
                <label className="block text-xs font-medium text-fg">Stage Theme Color</label>
                <select
                  value={newStageColor}
                  onChange={(e) => setNewStageColor(e.target.value)}
                  className="w-full bg-canvas border border-border text-fg text-xs rounded-xl p-2.5 focus:outline-none cursor-pointer"
                >
                  <option value="sky">Sky Blue</option>
                  <option value="indigo">Indigo</option>
                  <option value="purple">Purple</option>
                  <option value="amber">Amber Gold</option>
                  <option value="emerald">Emerald Green</option>
                  <option value="rose">Rose Red</option>
                </select>
              </div>

              <div className="flex gap-3 pt-2">
                <Button type="button" variant="secondary" onClick={() => setShowAddStageModal(false)} className="w-1/3">
                  Cancel
                </Button>
                <Button type="submit" variant="primary" className="w-2/3" icon={Plus}>
                  Create Stage
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Create Lead Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="w-full max-w-lg p-6 space-y-4 border-border shadow-2xl relative bg-surface">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h3 className="font-bold text-fg text-sm">Create New Opportunity</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateLead} className="space-y-4">
              <Input
                label="Opportunity / Deal Name"
                placeholder="e.g. Enterprise Platform Retainer"
                value={newDealName}
                onChange={(e) => setNewDealName(e.target.value)}
                required
              />

              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Company Name"
                  placeholder="e.g. Acme Corp"
                  value={newCompanyName}
                  onChange={(e) => setNewCompanyName(e.target.value)}
                />
                <Input
                  label="Contact Person"
                  placeholder="e.g. John Doe"
                  value={newContactName}
                  onChange={(e) => setNewContactName(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Contact Email"
                  type="email"
                  placeholder="john@acme.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                />
                <Input
                  label="Estimated Value (₹ INR)"
                  type="number"
                  placeholder="50000"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                />
              </div>

              <div className="space-y-1.5 text-left">
                <label className="block text-xs font-medium text-fg">Initial Pipeline Stage</label>
                <select
                  value={newStageId}
                  onChange={(e) => setNewStageId(e.target.value)}
                  className="w-full bg-canvas border border-border text-fg text-sm rounded-xl py-2.5 px-3.5 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all cursor-pointer"
                >
                  {stages.map((s) => (
                    <option key={s.id} value={s.id} className="bg-surface text-fg">
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-3 pt-2">
                <Button type="button" variant="secondary" onClick={() => setShowAddModal(false)} className="w-1/3">
                  Cancel
                </Button>
                <Button type="submit" variant="primary" className="w-2/3" icon={Plus}>
                  Save Opportunity
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Lead Detail Drawer / Modal */}
      {selectedLead && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-end">
          <div className="w-full max-w-md h-full bg-surface border-l border-border p-6 flex flex-col justify-between overflow-y-auto space-y-6 text-fg">
            <div className="space-y-6">
              <div className="flex items-center justify-between pb-4 border-b border-border">
                <div>
                  <h3 className="font-bold text-fg text-lg">{selectedLead.name}</h3>
                  <p className="text-xs text-accent font-medium">{selectedLead.companyName}</p>
                </div>
                <button
                  onClick={() => setSelectedLead(null)}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between p-3 rounded-xl bg-canvas border border-border">
                  <span className="text-muted font-medium">Deal Value</span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400 text-base">
                    ₹{Number(selectedLead.estimatedValue).toLocaleString('en-IN')}
                  </span>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between py-1 border-b border-border/60">
                    <span className="text-muted font-medium">Stage</span>
                    <Badge variant="brand">{selectedLead.pipelineStage}</Badge>
                  </div>
                  <div className="flex justify-between py-1 border-b border-border/60">
                    <span className="text-muted font-medium">Lead Score</span>
                    <Badge variant="success">{selectedLead.score} / 100</Badge>
                  </div>
                  <div className="flex justify-between py-1 border-b border-border/60">
                    <span className="text-muted font-medium">Contact Person</span>
                    <span className="text-fg font-medium">{selectedLead.contactName}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-border/60">
                    <span className="text-muted font-medium">Email</span>
                    <span className="text-fg font-medium">{selectedLead.email || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-border/60">
                    <span className="text-muted font-medium">Owner</span>
                    <span className="text-fg font-medium">{selectedLead.ownerName}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-border flex gap-3">
              <Button
                variant="danger"
                size="sm"
                icon={Trash2}
                onClick={() => {
                  setDeleteConfirmLead(selectedLead)
                  setSelectedLead(null)
                }}
              >
                Delete Deal
              </Button>
              <Button
                variant="primary"
                size="sm"
                className="flex-1"
                onClick={() => setSelectedLead(null)}
              >
                Done
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Delete Deal Modal */}
      {deleteConfirmLead && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="w-full max-w-md p-6 space-y-4 border-border shadow-2xl relative bg-surface">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h3 className="font-bold text-fg text-sm flex items-center gap-2">
                <Trash2 className="w-4 h-4 text-rose-500" /> Confirm Delete Opportunity
              </h3>
              <button
                onClick={() => setDeleteConfirmLead(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-muted leading-relaxed">
              Are you sure you want to delete <strong className="text-slate-900 dark:text-white">{deleteConfirmLead.name}</strong> ({deleteConfirmLead.companyName || 'Lead'})? This action cannot be undone.
            </p>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-border">
              <Button variant="secondary" onClick={() => setDeleteConfirmLead(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={async () => {
                  const id = deleteConfirmLead.leadId || deleteConfirmLead.id
                  deleteLead(id)
                  await deleteLeadFromDb(null, id)
                  setDeleteConfirmLead(null)
                }}
              >
                Yes, Delete Opportunity
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
