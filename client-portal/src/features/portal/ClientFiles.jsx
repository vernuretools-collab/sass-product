import React, { useState, useEffect } from 'react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { usePortalStore } from './stores/portalStore'
import { useUserStore } from '../../stores/userStore'
import { getClientDeliverables } from './services/portalService'
import { db } from '../../shared/services/firebaseService'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { resolveFileUrl } from 'firebase/storage'
import { getClientOnboardingDoc, resolveAgreements } from '../../shared/services/onboardingService'
import { downloadAgreementRecordAsPDF } from '../../shared/utils/agreementPdf'
import {
  FileText,
  Download,
  Eye,
  FileImage,
  FileCode,
  FileSpreadsheet,
  File,
  Loader2,
  FolderOpen,
  X,
  Scale,
} from 'lucide-react'

export const ClientFiles = () => {
  const { user } = useUserStore()
  const { files, setFiles } = usePortalStore()
  const [isLoading, setIsLoading] = useState(false)
  const [filterCategory, setFilterCategory] = useState('All')
  const [previewDoc, setPreviewDoc] = useState(null)
  const [agreements, setAgreements] = useState([])
  const [agreementRecords, setAgreementRecords] = useState({})
  const [companyName, setCompanyName] = useState('')

  useEffect(() => {
    if (!user?.uid) return

    setIsLoading(true)
    const delivRef = collection(db, 'deliverables')
    const q1 = query(delivRef, where('clientId', '==', user.uid))

    const unsub1 = onSnapshot(
      q1,
      (snap) => {
        const list = snap.docs.map((d) => ({ fileId: d.id, ...d.data() }))
        setFiles(list)
        setIsLoading(false)
      },
      async () => {
        // Fallback to fetch
        const docs = await getClientDeliverables(user.uid, user.email)
        setFiles(docs)
        setIsLoading(false)
      }
    )

    return () => unsub1()
  }, [user, setFiles])

  useEffect(() => {
    if (!user?.uid) return
    let cancelled = false
    getClientOnboardingDoc(user.uid)
      .then((data) => {
        if (cancelled) return
        setAgreements(resolveAgreements(data?.agreementTexts))
        setAgreementRecords(data?.agreements || {})
        setCompanyName(data?.companyName || '')
      })
      .catch(() => {
        if (cancelled) return
        setAgreements(resolveAgreements(null))
      })
    return () => {
      cancelled = true
    }
  }, [user?.uid])

  const handleDownloadAgreement = (ag) => {
    downloadAgreementRecordAsPDF({
      id: ag.id,
      title: ag.title,
      content: ag.content,
      sigRecord: agreementRecords[ag.id],
      clientName: companyName || user?.displayName,
    })
  }


  // Helpers to get file type icon
  const getFileIcon = (filename = '', fileType = '') => {
    const lower = (filename + ' ' + fileType).toLowerCase()
    if (lower.includes('.pdf') || lower.includes('pdf')) {
      return (
        <div className="w-11 h-11 rounded-xl bg-red-50 dark:bg-red-500/15 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
          <FileText className="w-5 h-5" />
        </div>
      )
    }
    if (lower.includes('.png') || lower.includes('.jpg') || lower.includes('.jpeg') || lower.includes('.webp') || lower.includes('image')) {
      return (
        <div className="w-11 h-11 rounded-xl bg-accent-soft text-accent flex items-center justify-center shrink-0">
          <FileImage className="w-5 h-5" />
        </div>
      )
    }
    if (lower.includes('.xls') || lower.includes('.xlsx') || lower.includes('.csv')) {
      return (
        <div className="w-11 h-11 rounded-xl bg-emerald-50 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
          <FileSpreadsheet className="w-5 h-5" />
        </div>
      )
    }
    if (lower.includes('.js') || lower.includes('.json') || lower.includes('.html') || lower.includes('.zip')) {
      return (
        <div className="w-11 h-11 rounded-xl bg-amber-50 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
          <FileCode className="w-5 h-5" />
        </div>
      )
    }
    return (
      <div className="w-11 h-11 rounded-xl bg-accent-soft text-accent flex items-center justify-center shrink-0">
        <File className="w-5 h-5" />
      </div>
    )
  }

  // Handle file view / preview
  // Files in storage are private: get a short-lived signed URL from the stored path at the moment
  // of use. The persisted downloadURL may be an expired signed URL or an old public URL.
  const fileUrl = async (f) => {
    if (f.storagePath) {
      try {
        const signed = await resolveFileUrl(f.storagePath)
        if (signed) return signed
      } catch (err) {
        console.warn('Could not open file:', err?.message || err)
        return null
      }
    }
    return f.fileUrl || f.url || f.downloadURL || null
  }

  const handleView = async (f) => {
    const url = await fileUrl(f)
    if (url) {
      // If it's an external link or image/pdf, we can preview or open in new tab
      window.open(url, '_blank', 'noopener,noreferrer')
    } else {
      setPreviewDoc(f)
    }
  }

  // Handle file download
  const handleDownload = async (f) => {
    const url = await fileUrl(f)
    const name = f.filename || f.fileName || f.name || 'document'
    if (url) {
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = name
        link.target = '_blank'
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
      } catch {
        window.open(url, '_blank')
      }
    } else {
      alert(`Preparing ${name} for download...`)
    }
  }

  const filteredFiles = files.filter((f) => {
    if (filterCategory === 'All') return true
    const cat = (f.category || 'Other').toLowerCase()
    return cat.includes(filterCategory.toLowerCase())
  })

  return (
    <div className="space-y-7 max-w-7xl mx-auto pb-10">
      <div>
        <h2 className="text-2xl font-bold text-fg tracking-tight">
          Documents & Deliverables
        </h2>
        <p className="text-sm text-muted mt-1">
          Download client contracts, design specifications, technical documentation, and project deliverables.
        </p>
      </div>

      {agreements.length > 0 && (
        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-fg">Legal agreements</h3>
            <p className="text-xs text-muted mt-0.5">
              MSA, NDA, and SOW — download each PDF separately.
            </p>
          </div>
          <div className="rounded-2xl border border-border overflow-hidden bg-surface">
            {agreements.map((ag, idx) => {
              const short =
                ag.id === 'msa' ? 'MSA' : ag.id === 'nda' ? 'NDA' : ag.id === 'sow' ? 'SOW' : ag.id.toUpperCase()
              const label = ag.title.replace(/\s*\((MSA|NDA|SOW)\)\s*$/i, '')
              return (
                <div
                  key={ag.id}
                  className={`flex items-center gap-3.5 px-4 py-3.5 ${
                    idx < agreements.length - 1 ? 'border-b border-slate-100 dark:border-slate-800/80' : ''
                  }`}
                >
                  <div className="w-10 h-10 rounded-xl bg-accent-soft text-accent flex items-center justify-center shrink-0">
                    <Scale className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-fg truncate">{label}</p>
                    <p className="text-[11px] text-muted mt-0.5">{short} · PDF</p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={Download}
                    onClick={() => handleDownloadAgreement(ag)}
                    className="shrink-0"
                  >
                    Download
                  </Button>
                </div>
              )
            })}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-fg">Project files</h3>
          <p className="text-xs text-muted mt-0.5">
            Specs, reports, and deliverables shared by your team.
          </p>
        </div>
      {/* Category Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {['All', 'Contract', 'Deliverable', 'Design Spec', 'Report', 'Technical', 'Other'].map((tab) => (
          <button
            key={tab}
            onClick={() => setFilterCategory(tab)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
              filterCategory === tab
                ? 'bg-accent text-white shadow-xs'
                : 'bg-chrome text-fg hover:bg-surface border border-border'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-muted">
          <Loader2 className="w-6 h-6 animate-spin mx-auto text-accent mb-2" />
          <span className="text-xs">Loading documents & deliverables...</span>
        </div>
      ) : filteredFiles.length === 0 ? (
        <Card className="p-12 text-center text-muted border-dashed space-y-3">
          <div className="w-12 h-12 rounded-full bg-chrome text-slate-400 flex items-center justify-center mx-auto">
            <FolderOpen className="w-6 h-6" />
          </div>
          <h4 className="text-sm font-bold text-fg">
            No downloadable deliverables uploaded yet
          </h4>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            Documents and project deliverables uploaded by the team for your organization will appear here automatically.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredFiles.map((f) => {
            const fileName = f.filename || f.fileName || f.name || 'Untitled Document'
            const fileSize = f.size || f.fileSize || '1.2 MB'
            const fileCategory = f.category || 'Deliverable'
            const uploadedDate = f.uploadedAt || f.date || 'Recent'
            const projectName = f.projectName || f.project || null

            return (
              <Card
                key={f.fileId || f.id || fileName}
                className="p-5 bg-surface border-border rounded-2xl shadow-2xs hover:shadow-xs transition-all flex flex-col justify-between gap-4"
              >
                <div className="flex items-start gap-3.5 min-w-0">
                  {getFileIcon(fileName, f.fileType)}
                  <div className="min-w-0 flex-1">
                    <h4 className="font-bold text-fg text-xs truncate" title={fileName}>
                      {fileName}
                    </h4>
                    {projectName && (
                      <p className="text-[11px] text-accent font-medium truncate mt-0.5">
                        {projectName}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400 dark:text-slate-400 mt-1.5">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium bg-chrome text-muted">
                        {fileCategory}
                      </span>
                      <span>{fileSize}</span>
                      <span>• {uploadedDate}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800/80">
                  <button
                    onClick={() => handleView(f)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 bg-chrome hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl border border-slate-200/80 dark:border-slate-700 text-xs font-semibold cursor-pointer transition-colors"
                  >
                    <Eye className="w-3.5 h-3.5 text-muted" />
                    <span>View</span>
                  </button>
                  <Button
                    size="sm"
                    variant="primary"
                    icon={Download}
                    onClick={() => handleDownload(f)}
                    className="bg-accent hover:bg-accent-hover text-white cursor-pointer px-3 py-1.5 text-xs font-semibold rounded-xl"
                  >
                    Download
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}
      </section>

      {/* Document Detail / Information Modal */}
      {previewDoc && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-surface border border-border rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-sm text-fg truncate">
                {previewDoc.filename || previewDoc.fileName || previewDoc.name}
              </h3>
              <button
                onClick={() => setPreviewDoc(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-slate-50 dark:bg-slate-950/60 p-4 rounded-xl border border-border space-y-3 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Category:</span>
                <span className="font-semibold text-fg">{previewDoc.category || 'Deliverable'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Size:</span>
                <span className="font-semibold text-fg">{previewDoc.size || '1.5 MB'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Uploaded Date:</span>
                <span className="font-semibold text-fg">{previewDoc.uploadedAt || 'Recent'}</span>
              </div>
              {previewDoc.description && (
                <div className="pt-2 border-t border-border">
                  <span className="text-slate-500 block mb-1">Description:</span>
                  <p className="text-fg">{previewDoc.description}</p>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPreviewDoc(null)}
              >
                Close
              </Button>
              <Button
                variant="primary"
                size="sm"
                icon={Download}
                onClick={() => {
                  handleDownload(previewDoc)
                  setPreviewDoc(null)
                }}
                className="bg-accent hover:bg-accent-hover text-white"
              >
                Download File
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


