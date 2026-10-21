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
  getContentItems,
  createContentItem,
  updateContentItemInDb,
  deleteContentItemFromDb,
} from './services/marketingService'
import {
  Megaphone,
  Calendar,
  Link as LinkIcon,
  Plus,
  X,
  Trash2,
  Edit2,
  Search,
  CheckCircle2,
  Clock,
  FileText,
  AlertTriangle,
} from 'lucide-react'

export const ContentCalendar = () => {
  const { claims } = useUserStore()
  const orgId = claims?.orgId || ''

  const { contentItems, addContentItem, updateContentItem, setContentItems, deleteContentItem } =
    useMarketingStore()

  const [searchQuery, setSearchQuery] = useState('')
  const [statusTab, setStatusTab] = useState('all')
  const [platformFilter, setPlatformFilter] = useState('all')

  const [showAddModal, setShowAddModal] = useState(false)
  const [editingItem, setEditingItem] = useState(null)
  const [deletingId, setDeletingId] = useState(null)

  // Add Form state
  const [title, setTitle] = useState('')
  const [platform, setPlatform] = useState('LinkedIn Article')
  const [scheduledDate, setScheduledDate] = useState('')
  const [author, setAuthor] = useState('Sarah Jenkins')

  // Edit Form state
  const [editTitle, setEditTitle] = useState('')
  const [editPlatform, setEditPlatform] = useState('LinkedIn Article')
  const [editScheduledDate, setEditScheduledDate] = useState('')
  const [editAuthor, setEditAuthor] = useState('')
  const [editStatus, setEditStatus] = useState('scheduled')

  useEffect(() => {
    const fetchRealContentItems = async () => {
      const data = await getContentItems(orgId)
      if (data) {
        setContentItems(data)
      }
    }
    fetchRealContentItems()
  }, [orgId, setContentItems])

  const filtered = contentItems.filter((item) => {
    const q = searchQuery.toLowerCase().trim()
    const matchesQuery =
      !q ||
      (item.title && item.title.toLowerCase().includes(q)) ||
      (item.author && item.author.toLowerCase().includes(q))

    const matchesStatus = statusTab === 'all' || item.status === statusTab
    const matchesPlatform = platformFilter === 'all' || item.platform === platformFilter

    return matchesQuery && matchesStatus && matchesPlatform
  })

  const handleCreateContent = async (e) => {
    e.preventDefault()
    if (!title.trim()) return

    const payload = {
      title,
      platform,
      scheduledDate: scheduledDate || new Date().toISOString().split('T')[0],
      author: author || 'Team Member',
      status: 'scheduled',
    }

    const created = await createContentItem(payload, orgId)
    addContentItem(created)

    setTitle('')
    setShowAddModal(false)
  }

  const openEditModal = (item) => {
    setEditingItem(item)
    setEditTitle(item.title || '')
    setEditPlatform(item.platform || 'LinkedIn Article')
    setEditScheduledDate(item.scheduledDate || '')
    setEditAuthor(item.author || '')
    setEditStatus(item.status || 'scheduled')
  }

  const handleUpdateContent = async (e) => {
    e.preventDefault()
    if (!editingItem || !editTitle.trim()) return

    const updatedFields = {
      title: editTitle,
      platform: editPlatform,
      scheduledDate: editScheduledDate,
      author: editAuthor,
      status: editStatus,
    }

    updateContentItem(editingItem.contentId, updatedFields)
    await updateContentItemInDb(editingItem.contentId, updatedFields, orgId)

    setEditingItem(null)
  }

  const handleStatusChange = async (item, newStatus) => {
    updateContentItem(item.contentId, { status: newStatus })
    await updateContentItemInDb(item.contentId, { status: newStatus }, orgId)
  }

  const confirmDeleteContent = async () => {
    if (!deletingId) return
    deleteContentItem(deletingId)
    await deleteContentItemFromDb(deletingId, orgId)
    setDeletingId(null)
  }

  const getStatusBadgeVariant = (status) => {
    switch (status) {
      case 'published':
        return 'success'
      case 'scheduled':
        return 'primary'
      case 'draft':
      default:
        return 'neutral'
    }
  }

  return (
    <div className="space-y-6">
      {/* Header & Navigation */}
      <div className="space-y-4">
        <PageHeader
          title="Content Calendar & Social Publisher"
          description="Schedule articles, whitepapers, social posts, and track publishing status across channels."
          actions={
            <Button icon={Plus} variant="primary" onClick={() => setShowAddModal(true)}>
              Schedule Post
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

      {/* Filter Strip & Tabs */}
      <Card className="p-3 space-y-3 border-border bg-surface">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          {/* Status Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto">
            {['all', 'scheduled', 'published', 'draft'].map((tab) => (
              <button
                key={tab}
                onClick={() => setStatusTab(tab)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold capitalize transition-all cursor-pointer whitespace-nowrap ${
                  statusTab === tab
                    ? 'bg-accent text-white shadow-sm'
                    : 'bg-chrome text-fg border border-border hover:bg-surface'
                }`}
              >
                {tab} ({tab === 'all' ? contentItems.length : contentItems.filter((i) => i.status === tab).length})
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-60">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search content..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-canvas border border-border text-fg text-xs rounded-xl pl-8 pr-3 py-1.5 focus:outline-none focus:border-accent"
              />
            </div>

            <select
              value={platformFilter}
              onChange={(e) => setPlatformFilter(e.target.value)}
              className="bg-canvas border border-border text-fg text-xs rounded-xl px-3 py-1.5 focus:outline-none cursor-pointer"
            >
              <option value="all">All Platforms</option>
              <option value="LinkedIn Article">LinkedIn Article</option>
              <option value="Engineering Blog">Engineering Blog</option>
              <option value="Newsletter">Newsletter</option>
              <option value="Twitter / X Thread">Twitter / X Thread</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Content Items Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filtered.map((item) => (
          <Card key={item.contentId} hover className="space-y-3 border-border bg-surface flex flex-col justify-between">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-accent">{item.platform}</span>
                <div className="flex items-center gap-2">
                  {/* Status Dropdown */}
                  <select
                    value={item.status}
                    onChange={(e) => handleStatusChange(item, e.target.value)}
                    className="bg-canvas border border-border text-[11px] font-semibold rounded-lg px-2 py-1 text-fg focus:outline-none cursor-pointer capitalize"
                  >
                    <option value="draft">Draft</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="published">Published</option>
                  </select>

                  <button
                    onClick={() => openEditModal(item)}
                    className="p-1 text-slate-400 hover:text-accent dark:hover:text-accent rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    title="Edit Content Item"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={() => setDeletingId(item.contentId)}
                    className="p-1 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    title="Delete Content"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <h4 className="font-bold text-fg text-sm leading-snug">{item.title}</h4>
            </div>

            <div className="flex justify-between items-center text-xs text-muted pt-2.5 border-t border-slate-100 dark:border-border">
              <span className="font-medium">Author: {item.author || 'Team'}</span>
              <span className="flex items-center gap-1 font-mono text-[11px]">
                <Clock className="w-3 h-3 text-accent" />
                {item.scheduledDate}
              </span>
            </div>
          </Card>
        ))}

        {filtered.length === 0 && (
          <div className="col-span-full p-8 text-center text-muted bg-surface rounded-2xl border border-border">
            No content scheduled matching your filters. Click "Schedule Post" to create one.
          </div>
        )}
      </div>

      {/* Schedule Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="w-full max-w-lg p-6 space-y-4 border-border shadow-2xl relative bg-surface">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h3 className="font-bold text-fg text-sm">Schedule Content Item</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateContent} className="space-y-4">
              <Input
                label="Content Title"
                placeholder="e.g. 5 SaaS Architecture Best Practices"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5 text-left">
                  <label className="block text-xs font-medium text-fg">Platform</label>
                  <select
                    value={platform}
                    onChange={(e) => setPlatform(e.target.value)}
                    className="w-full bg-canvas border border-border text-fg text-xs rounded-xl py-2.5 px-3.5 focus:outline-none cursor-pointer"
                  >
                    <option value="LinkedIn Article">LinkedIn Article</option>
                    <option value="Engineering Blog">Engineering Blog</option>
                    <option value="Newsletter">Newsletter</option>
                    <option value="Twitter / X Thread">Twitter / X Thread</option>
                  </select>
                </div>

                <Input
                  label="Target Publish Date"
                  type="date"
                  value={scheduledDate}
                  onChange={(e) => setScheduledDate(e.target.value)}
                />
              </div>

              <Input
                label="Author"
                placeholder="Sarah Jenkins"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
              />

              <div className="flex gap-3 pt-2">
                <Button type="button" variant="secondary" onClick={() => setShowAddModal(false)} className="w-1/3">
                  Cancel
                </Button>
                <Button type="submit" variant="primary" className="w-2/3" icon={Plus}>
                  Schedule Post
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Edit Modal */}
      {editingItem && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="w-full max-w-lg p-6 space-y-4 border-border shadow-2xl relative bg-surface">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h3 className="font-bold text-fg text-sm">Edit Scheduled Content</h3>
              <button
                onClick={() => setEditingItem(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUpdateContent} className="space-y-4">
              <Input
                label="Content Title"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                required
              />

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5 text-left">
                  <label className="block text-xs font-medium text-fg">Platform</label>
                  <select
                    value={editPlatform}
                    onChange={(e) => setEditPlatform(e.target.value)}
                    className="w-full bg-canvas border border-border text-fg text-xs rounded-xl py-2.5 px-3.5 focus:outline-none cursor-pointer"
                  >
                    <option value="LinkedIn Article">LinkedIn Article</option>
                    <option value="Engineering Blog">Engineering Blog</option>
                    <option value="Newsletter">Newsletter</option>
                    <option value="Twitter / X Thread">Twitter / X Thread</option>
                  </select>
                </div>

                <div className="space-y-1.5 text-left">
                  <label className="block text-xs font-medium text-fg">Status</label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value)}
                    className="w-full bg-canvas border border-border text-fg text-xs rounded-xl py-2.5 px-3.5 focus:outline-none cursor-pointer"
                  >
                    <option value="draft">Draft</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="published">Published</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Publish Date"
                  type="date"
                  value={editScheduledDate}
                  onChange={(e) => setEditScheduledDate(e.target.value)}
                />

                <Input
                  label="Author"
                  value={editAuthor}
                  onChange={(e) => setEditAuthor(e.target.value)}
                />
              </div>

              <div className="flex gap-3 pt-2">
                <Button type="button" variant="secondary" onClick={() => setEditingItem(null)} className="w-1/3">
                  Cancel
                </Button>
                <Button type="submit" variant="primary" className="w-2/3">
                  Update Content
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
              <h3 className="font-bold text-fg text-sm">Delete Content Post?</h3>
              <p className="text-xs text-muted mt-1">
                Are you sure you want to delete this scheduled post? This action cannot be undone.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setDeletingId(null)} className="w-1/2">
                Cancel
              </Button>
              <Button variant="danger" onClick={confirmDeleteContent} className="w-1/2">
                Delete
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
