import React, { useState, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { PageHeader } from '../../components/layout/PageHeader'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { useCRMStore } from './stores/crmStore'
import { getLeads, updateLeadStageInDb, deleteLeadFromDb } from './services/crmService'
import {
  Kanban,
  List,
  Contact,
  Search,
  Plus,
  Trash2,
  Building,
  User,
  DollarSign
} from 'lucide-react'

export const LeadList = () => {
  const { leads, stages, setLeads, deleteLead, updateLeadStage, searchQuery, setSearchQuery } = useCRMStore()
  const [selectedStage, setSelectedStage] = useState('all')

  useEffect(() => {
    const fetchRealLeads = async () => {
      const data = await getLeads(null)
      if (data && data.length > 0) {
        setLeads(data)
      }
    }
    fetchRealLeads()
  }, [setLeads])

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

  const filtered = leads.filter((l) => {
    const matchesSearch =
      !searchQuery ||
      (l.name && l.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (l.companyName && l.companyName.toLowerCase().includes(searchQuery.toLowerCase()))
    const matchesStage = selectedStage === 'all' || l.pipelineStageId === selectedStage
    return matchesSearch && matchesStage
  })

  return (
    <div className="space-y-6">
      {/* Header & Nav */}
      <div className="space-y-4">
        <PageHeader
          title="All Leads Directory"
          description="Filterable list view of all opportunities across pipeline stages"
        />

        {/* Sub-Navigation & Filters */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 border-b border-border pb-3">
          <div className="flex items-center gap-2 w-full md:w-auto">
            <NavLink
              to="/crm/pipeline"
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                  isActive
                    ? 'bg-accent-soft text-accent border border-accent/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
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
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
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
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`
              }
            >
              <Contact className="w-3.5 h-3.5" /> Contacts Directory
            </NavLink>
          </div>

          <div className="flex items-center gap-3 w-full md:w-auto">
            <select
              value={selectedStage}
              onChange={(e) => setSelectedStage(e.target.value)}
              className="bg-canvas border border-border text-xs text-fg rounded-xl px-3 py-1.5 focus:outline-none transition-colors"
            >
              <option value="all">All Stages</option>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>

            <div className="relative w-64">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="text"
                placeholder="Search leads..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-canvas border border-border text-xs text-fg placeholder:text-muted rounded-xl pl-8 pr-3 py-1.5 focus:outline-none focus:border-accent transition-colors"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <Card className="overflow-x-auto p-0 border-border">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-canvas/80 border-b border-border text-slate-700 dark:text-slate-400">
              <th className="p-4 font-semibold">Deal Name</th>
              <th className="p-4 font-semibold">Company</th>
              <th className="p-4 font-semibold">Contact</th>
              <th className="p-4 font-semibold">Est. Value</th>
              <th className="p-4 font-semibold">Stage</th>
              <th className="p-4 font-semibold">Lead Score</th>
              <th className="p-4 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-muted">
                  No leads found matching your criteria.
                </td>
              </tr>
            ) : (
              filtered.map((lead) => (
                <tr key={lead.leadId} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                  <td className="p-4 font-bold text-slate-900 dark:text-slate-200">{lead.name}</td>
                  <td className="p-4 text-fg">{lead.companyName}</td>
                  <td className="p-4 text-muted">{lead.contactName}</td>
                  <td className="p-4 font-semibold text-emerald-600 dark:text-emerald-400">
                    ₹{Number(lead.estimatedValue).toLocaleString('en-IN')}
                  </td>
                  <td className="p-4">
                    <select
                      value={lead.pipelineStageId}
                      onChange={(e) => handleStageChange(lead.leadId, e.target.value)}
                      className="bg-surface border border-border text-xs text-fg rounded px-2 py-1 focus:outline-none"
                    >
                      {stages.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-4">
                    <Badge
                      variant={
                        lead.score >= 85
                          ? 'success'
                          : lead.score >= 70
                          ? 'info'
                          : 'warning'
                      }
                    >
                      {lead.score || 70} / 100
                    </Badge>
                  </td>
                  <td className="p-4 text-right">
                    <button
                      onClick={() => handleDeleteLead(lead.leadId)}
                      className="p-1.5 hover:bg-rose-500/10 text-slate-400 hover:text-rose-400 rounded-lg transition-colors"
                      title="Delete Lead"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
