import React, { useState, useEffect, useRef } from 'react'
import { useUserStore } from '../../stores/userStore'
import { useProjectStore } from '../projects/stores/projectStore'
import { PageHeader } from '../../components/layout/PageHeader'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Input } from '../../components/ui/Input'
import { db, storage } from '../../shared/services/firebaseService'
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore'
import { ref, uploadBytesResumable, getDownloadURL, deleteObject, resolveFileUrl } from 'firebase/storage'
import {
  Send,
  Upload,
  FileText,
  FileImage,
  FileCode,
  FileSpreadsheet,
  File,
  Download,
  Eye,
  Trash2,
  CheckCircle2,
  FolderOpen,
  Building2,
  Loader2,
  Filter,
} from 'lucide-react'

// Deliverables are private: sign the stored path at the moment of use instead of trusting the
// persisted downloadURL (it expires, and older rows carry a public URL that no longer works).
async function openableUrl(docItem) {
  if (docItem.storagePath) {
    try {
      const signed = await resolveFileUrl(docItem.storagePath)
      if (signed) return signed
    } catch (err) {
      console.warn('Could not open deliverable:', err?.message || err)
      return null
    }
  }
  return docItem.fileUrl || docItem.url || docItem.downloadURL || null
}

export const ClientDocumentsPage = ({ embedded = false, lockedProjectId = null }) => {
  const { user } = useUserStore()
  const { projects, fetchProjectsAndTasks } = useProjectStore()
  const [clients, setClients] = useState([])
  const [clientProjects, setClientProjects] = useState([])
  const [deliverables, setDeliverables] = useState([])
  const [loading, setLoading] = useState(true)

  // Upload Form State
  const [selectedClientId, setSelectedClientId] = useState('')
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [category, setCategory] = useState('Deliverable')
  const [description, setDescription] = useState('')
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [successMessage, setSuccessMessage] = useState('')
  const fileInputRef = useRef(null)

  // Filter State
  const [clientFilter, setClientFilter] = useState('All')
  const [categoryFilter, setCategoryFilter] = useState('All')

  // 1. Fetch all registered clients from Firestore
  useEffect(() => {
    const fetchClients = async () => {
      try {
        const q = query(collection(db, 'users'), where('role', '==', 'client'))
        const snap = await getDocs(q)
        const list = snap.docs.map((d) => ({ uid: d.id, ...d.data() }))
        setClients(list)
        if (list.length > 0 && !selectedClientId && !lockedProjectId) {
          setSelectedClientId(list[0].uid)
        }
      } catch (err) {
        console.warn('Could not fetch client list:', err)
      }
    }
    fetchClients()
  }, [])

  useEffect(() => {
    if (lockedProjectId) fetchProjectsAndTasks()
  }, [lockedProjectId, fetchProjectsAndTasks])

  const lockedProject = projects.find(
    (p) => p.projectId === lockedProjectId || p.id === lockedProjectId
  )

  useEffect(() => {
    if (!lockedProject) return
    if (lockedProject.clientId) setSelectedClientId(lockedProject.clientId)
    setSelectedProjectId(lockedProject.projectId || lockedProject.id || '')
    if (lockedProject.clientId) setClientFilter(lockedProject.clientId)
  }, [lockedProject])

  // 2. Fetch projects for selected client
  useEffect(() => {
    const fetchProjects = async () => {
      if (!selectedClientId) {
        setClientProjects([])
        return
      }
      try {
        const q = query(collection(db, 'projects'), where('clientId', '==', selectedClientId))
        const snap = await getDocs(q)
        setClientProjects(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => !p.deletedAt))
      } catch (err) {
        console.warn('Could not fetch client projects:', err)
      }
    }
    fetchProjects()
  }, [selectedClientId])

  // 3. Real-time subscription to deliverables
  useEffect(() => {
    const q = query(collection(db, 'deliverables'), orderBy('uploadedAtTimestamp', 'desc'))
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const docs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))
        setDeliverables(docs)
        setLoading(false)
      },
      (err) => {
        console.warn('Deliverables onSnapshot fallback without order:', err)
        // Fallback without timestamp index requirement
        const fallbackSub = onSnapshot(collection(db, 'deliverables'), (snap) => {
          setDeliverables(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
          setLoading(false)
        })
        return () => fallbackSub()
      }
    )
    return () => unsubscribe()
  }, [])

  const handleFileChange = (e) => {
    if (e.target.files[0]) {
      setFile(e.target.files[0])
    }
  }

  const handleUploadDeliverable = async () => {
    if (!file || !selectedClientId) return

    setUploading(true)
    setProgress(0)
    setSuccessMessage('')

    const targetClient = clients.find((c) => c.uid === selectedClientId) || {}
    const targetProject =
      clientProjects.find((p) => p.id === selectedProjectId) ||
      projects.find((p) => p.projectId === selectedProjectId || p.id === selectedProjectId) ||
      {}
    const timestamp = Date.now()
    const storagePath = `deliverables/${selectedClientId}/${file.name}_${timestamp}`
    const storageRef = ref(storage, storagePath)

    const uploadTask = uploadBytesResumable(storageRef, file)

    uploadTask.on(
      'state_changed',
      (snapshot) => {
        const prog = (snapshot.bytesTransferred / snapshot.totalBytes) * 100
        setProgress(prog)
      },
      (error) => {
        console.error('Deliverable upload error:', error)
        alert('Upload failed: ' + error.message)
        setUploading(false)
      },
      async () => {
        try {
          const downloadURL = await getDownloadURL(uploadTask.snapshot.ref)
          const deliverableData = {
            filename: file.name,
            fileName: file.name,
            fileType: file.type,
            fileSize: file.size,
            size: `${(file.size / (1024 * 1024)).toFixed(2)} MB`,
            storagePath,
            downloadURL,
            fileUrl: downloadURL,
            uploadedAt: new Date().toLocaleDateString('en-US', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            }),
            uploadedAtTimestamp: serverTimestamp(),
            description: description || '',
            category,
            clientId: selectedClientId,
            clientEmail: targetClient.email || '',
            clientName: targetClient.displayName || targetClient.companyName || 'Client',
            projectId: selectedProjectId || '',
            projectName: targetProject.name || targetProject.title || '',
            uploadedBy: user?.uid || 'employee',
            uploadedByName: user?.displayName || 'Staff',
          }

          const docRef = await addDoc(collection(db, 'deliverables'), deliverableData)
          // Also sync to clientDocuments
          await addDoc(collection(db, 'clientDocuments'), { id: docRef.id, ...deliverableData }).catch(() => {})

          setSuccessMessage(
            `Document "${file.name}" successfully sent to ${targetClient.displayName || 'client'}! It is now visible in their portal.`
          )
          setFile(null)
          setDescription('')
          if (fileInputRef.current) fileInputRef.current.value = ''
        } catch (err) {
          console.error('Firestore save failed:', err)
          alert('Error saving record: ' + err.message)
        } finally {
          setUploading(false)
          setProgress(0)
        }
      }
    )
  }

  const handleDeleteDeliverable = async (item) => {
    if (!window.confirm(`Are you sure you want to delete "${item.filename || item.fileName}"?`)) return
    try {
      if (item.id) {
        await deleteDoc(doc(db, 'deliverables', item.id))
      }
      if (item.storagePath) {
        const fileRef = ref(storage, item.storagePath)
        await deleteObject(fileRef).catch(() => {})
      }
    } catch (err) {
      console.error('Delete error:', err)
      alert('Delete failed: ' + err.message)
    }
  }

  const getFileIcon = (filename = '', type = '') => {
    const lower = (filename + ' ' + type).toLowerCase()
    if (lower.includes('.pdf') || lower.includes('pdf'))
      return <FileText className="w-6 h-6 text-red-500" />
    if (lower.includes('.png') || lower.includes('.jpg') || lower.includes('.jpeg') || lower.includes('image'))
      return <FileImage className="w-6 h-6 text-accent" />
    if (lower.includes('.xls') || lower.includes('.xlsx') || lower.includes('.csv'))
      return <FileSpreadsheet className="w-6 h-6 text-emerald-500" />
    if (lower.includes('.js') || lower.includes('.json') || lower.includes('.html') || lower.includes('.zip'))
      return <FileCode className="w-6 h-6 text-amber-500" />
    return <File className="w-6 h-6 text-accent" />
  }

  const filteredDeliverables = deliverables.filter((d) => {
    if (lockedProjectId) {
      const matchesProject = d.projectId === lockedProjectId
      const matchesCategory =
        categoryFilter === 'All' || (d.category || '').toLowerCase() === categoryFilter.toLowerCase()
      return matchesProject && matchesCategory
    }
    const matchesClient = clientFilter === 'All' || d.clientId === clientFilter
    const matchesCategory =
      categoryFilter === 'All' || (d.category || '').toLowerCase() === categoryFilter.toLowerCase()
    return matchesClient && matchesCategory
  })

  const projectSelectOptions = (() => {
    const options = [...clientProjects]
    if (lockedProject) {
      const lid = lockedProject.projectId || lockedProject.id
      if (!options.some((p) => p.id === lid || p.projectId === lid)) {
        options.unshift({ id: lid, name: lockedProject.name })
      }
    }
    return options
  })()

  return (
    <div className="space-y-6 pb-12">
      {!embedded && (
        <PageHeader
          title="Client Documents"
          description="Upload and manage deliverables, contracts, specifications, and reports shared directly with clients."
        />
      )}

      {/* Upload Section */}
      <Card className="p-6 bg-surface border-border rounded-2xl shadow-sm">
        <div className="flex items-center gap-2 mb-4 text-fg font-bold text-base">
          <Send className="w-5 h-5 text-accent" />
          <h3>Send Document to Client Portal</h3>
        </div>

        {successMessage && (
          <div className="mb-4 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs font-semibold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Target Client */}
          <div>
            <label className="block text-xs font-semibold text-fg mb-1">
              Select Client <span className="text-red-500">*</span>
            </label>
            <select
              value={selectedClientId}
              onChange={(e) => setSelectedClientId(e.target.value)}
              disabled={Boolean(lockedProjectId)}
              className="w-full h-10 px-3 rounded-xl border border-border bg-surface text-xs text-fg focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {clients.length === 0 ? (
                <option value="">No clients registered</option>
              ) : (
                clients.map((c) => (
                  <option key={c.uid} value={c.uid}>
                    {c.displayName || c.email} ({c.companyName || 'Client Entity'})
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Associated Project */}
          <div>
            <label className="block text-xs font-semibold text-fg mb-1">
              Associated Project (Optional)
            </label>
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              disabled={Boolean(lockedProjectId)}
              className="w-full h-10 px-3 rounded-xl border border-border bg-surface text-xs text-fg focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-70 disabled:cursor-not-allowed"
            >
              <option value="">-- General Deliverable --</option>
              {projectSelectOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name || p.title}
                </option>
              ))}
            </select>
          </div>

          {/* Deliverable Category */}
          <div>
            <label className="block text-xs font-semibold text-fg mb-1">
              Document Category
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full h-10 px-3 rounded-xl border border-border bg-surface text-xs text-fg focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="Deliverable">Project Deliverable</option>
              <option value="Contract">Contract / Agreement</option>
              <option value="Design Spec">Design Specification</option>
              <option value="Technical">Technical Spec</option>
              <option value="Report">Audit & Milestone Report</option>
              <option value="Asset">Asset / Export</option>
              <option value="Other">Other</option>
            </select>
          </div>

          {/* File Input */}
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-fg mb-1">
              Choose File <span className="text-red-500">*</span>
            </label>
            <input
              type="file"
              onChange={handleFileChange}
              ref={fileInputRef}
              className="block w-full text-xs text-slate-500 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-accent-soft file:text-accent hover:file:bg-accent-soft dark:file:text-accent cursor-pointer"
            />
          </div>

          {/* Note / Description */}
          <div>
            <label className="block text-xs font-semibold text-fg mb-1">
              Note / Description
            </label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Master Services Agreement v2.0"
              className="text-xs"
            />
          </div>

          {/* Upload Button */}
          <div className="md:col-span-3 flex justify-end pt-2">
            <Button
              onClick={handleUploadDeliverable}
              disabled={!file || !selectedClientId || uploading}
              className="bg-accent hover:bg-accent-hover text-white flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold cursor-pointer"
            >
              {uploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Uploading ({Math.round(progress)}%)...</span>
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  <span>Send to Client's Documents</span>
                </>
              )}
            </Button>
          </div>
        </div>

        {uploading && (
          <div className="mt-4 w-full bg-chrome rounded-full h-2 overflow-hidden">
            <div
              className="bg-accent h-full rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </Card>

      {/* Filter and List Section */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h3 className="font-bold text-fg text-base">
            Shared Client Deliverables ({filteredDeliverables.length})
          </h3>

          <div className="flex flex-wrap items-center gap-2">
            {!embedded && (
              <select
                value={clientFilter}
                onChange={(e) => setClientFilter(e.target.value)}
                className="h-9 px-3 rounded-xl border border-border bg-surface text-xs text-fg focus:outline-none"
              >
                <option value="All">All Clients</option>
                {clients.map((c) => (
                  <option key={c.uid} value={c.uid}>
                    {c.displayName || c.companyName || c.email}
                  </option>
                ))}
              </select>
            )}

            {/* Filter by category */}
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="h-9 px-3 rounded-xl border border-border bg-surface text-xs text-fg focus:outline-none"
            >
              <option value="All">All Categories</option>
              <option value="Deliverable">Deliverable</option>
              <option value="Contract">Contract</option>
              <option value="Design Spec">Design Spec</option>
              <option value="Technical">Technical</option>
              <option value="Report">Report</option>
              <option value="Asset">Asset</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="py-16 text-center text-slate-500">
            <Loader2 className="w-6 h-6 animate-spin mx-auto text-accent mb-2" />
            <span className="text-xs">Loading client deliverables...</span>
          </div>
        ) : filteredDeliverables.length === 0 ? (
          <Card className="p-12 text-center text-muted border-dashed space-y-2">
            <FolderOpen className="w-10 h-10 mx-auto text-slate-400" />
            <p className="text-sm font-semibold text-fg">
              No client documents found
            </p>
            <p className="text-xs text-slate-400">
              Upload a document above to securely send it to a client's portal.
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredDeliverables.map((docItem) => {
              const fileName = docItem.filename || docItem.fileName || 'Document'
              const clientLabel = docItem.clientName || docItem.clientEmail || 'Client'
              const fileUrl = docItem.downloadURL || docItem.fileUrl || docItem.url

              return (
                <Card
                  key={docItem.id}
                  className="p-4 bg-surface border-border rounded-2xl shadow-2xs hover:shadow-xs transition-all flex flex-col justify-between"
                >
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="p-2.5 rounded-xl bg-chrome shrink-0">
                        {getFileIcon(fileName, docItem.fileType)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h4
                          className="font-bold text-xs text-fg truncate"
                          title={fileName}
                        >
                          {fileName}
                        </h4>
                        <div className="flex items-center gap-1.5 mt-1 text-[11px] text-accent font-semibold truncate">
                          <Building2 className="w-3 h-3 shrink-0" />
                          <span className="truncate">{clientLabel}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted">
                      <span className="px-2 py-0.5 rounded-md bg-chrome font-medium">
                        {docItem.category || 'Deliverable'}
                      </span>
                      <span>{docItem.size || '1 MB'}</span>
                      <span>• {docItem.uploadedAt || 'Recent'}</span>
                    </div>

                    {docItem.projectName && (
                      <p className="text-[11px] text-muted truncate">
                        Project: <strong className="text-fg font-medium">{docItem.projectName}</strong>
                      </p>
                    )}

                    {docItem.description && (
                      <p className="text-[11px] text-muted line-clamp-2">
                        {docItem.description}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-3 mt-3 border-t border-slate-100 dark:border-slate-800/80">
                    <button
                      onClick={() => handleDeleteDeliverable(docItem)}
                      className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors cursor-pointer"
                      title="Delete Deliverable"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>

                    <div className="flex items-center gap-2">
                      {fileUrl && (
                        <button
                          onClick={async () => {
                            const url = await openableUrl(docItem)
                            if (url) window.open(url, '_blank', 'noopener,noreferrer')
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-chrome hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-semibold cursor-pointer border border-border"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>View</span>
                        </button>
                      )}
                      {fileUrl && (
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={Download}
                          onClick={async () => {
                            const url = await openableUrl(docItem)
                            if (!url) return
                            const link = document.createElement('a')
                            link.href = url
                            link.download = fileName
                            link.target = '_blank'
                            document.body.appendChild(link)
                            link.click()
                            document.body.removeChild(link)
                          }}
                          className="text-xs px-2.5 py-1"
                        >
                          Download
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
