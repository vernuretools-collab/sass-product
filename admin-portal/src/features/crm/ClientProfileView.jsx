import React, { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { PageHeader } from '../../components/layout/PageHeader'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { getUserDoc, setClientPassword } from '../../shared/services/authService'
import { clientLoginLabel, isSyntheticClientEmail } from '../../../../shared/supabase/clientLogin.js'
import { updateClientInDb } from './services/clientService'
import {
  getClientOnboardingAdmin,
  approveClientOnboarding,
  rejectClientOnboarding,
  updateClientAgreementText,
  updateClientBillingProfile,
  setClientAgreementsWaiver,
} from './services/clientOnboardingService'
import {
  DEFAULT_AGREEMENTS,
  resolveAgreements,
  normalizeOnboardingStatus,
} from '../../shared/services/contractTemplates'
import { downloadAgreementRecordAsPDF } from '../../shared/utils/agreementPdf'
import { db, auth } from '../../shared/services/firebaseService'
import { sendPasswordResetEmail } from 'firebase/auth'
import { collection, query, where, getDocs, doc, onSnapshot } from 'firebase/firestore'
import {
  ArrowLeft,
  User,
  Phone,
  Building,
  Calendar,
  Lock,
  ShieldCheck,
  Save,
  CheckCircle,
  FileText,
  Briefcase,
  AlertCircle,
  FileCheck2,
  CreditCard,
  Check,
  XCircle,
  Clock,
  AlertTriangle,
  Eye,
  X,
  FileCode,
  Shield,
  FileSignature,
  RotateCcw,
  PencilLine,
  Download,
} from 'lucide-react'

const LocalSpinner = () => (
  <div className="flex items-center justify-center p-8">
    <div className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin"></div>
  </div>
)

export const ClientProfileView = () => {
  const { clientId } = useParams()
  const navigate = useNavigate()

  const [client, setClient] = useState(null)
  const [onboarding, setOnboarding] = useState(null)
  const [projects, setProjects] = useState([])
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)

  // Active Tab: 'compliance' | 'contracts' | 'details'
  const [activeTab, setActiveTab] = useState('compliance')

  // Per-client contract wording editor
  const [contractId, setContractId] = useState('msa')
  const [contractDraft, setContractDraft] = useState({ title: '', summary: '', content: '' })
  const [contractDirty, setContractDirty] = useState(false)

  // Edit fields
  const [displayName, setDisplayName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [status, setStatus] = useState('active')
  const [notes, setNotes] = useState('')
  const [taxId, setTaxId] = useState('')
  const [billingAddress, setBillingAddress] = useState('')
  const [billingEmail, setBillingEmail] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('ach')
  const [signerPhone, setSignerPhone] = useState('')
  const [signatoryTitle, setSignatoryTitle] = useState('')
  const [skipAgreements, setSkipAgreements] = useState(false)

  // Modals
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [previewAgreement, setPreviewAgreement] = useState(null) // { id, title, sigRecord }

  const [newPassword, setNewPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const loadClientData = async () => {
    try {
      setLoading(true)
      const clientDoc = await getUserDoc(clientId)
      if (!clientDoc) {
        setError('Client account not found in database.')
        setLoading(false)
        return
      }

      setClient(clientDoc)
      setDisplayName(clientDoc.displayName || '')
      setCompanyName(clientDoc.companyName || '')
      setPhoneNumber(clientDoc.phoneNumber || '')
      setStatus(clientDoc.status || 'active')
      setNotes(clientDoc.notes || '')

      // Load Onboarding & Compliance Documents
      const obData = await getClientOnboardingAdmin(clientId)
      setOnboarding(obData)
      setTaxId(obData?.billingInfo?.taxId || '')
      setBillingAddress(obData?.billingInfo?.billingAddress || '')
      setBillingEmail(obData?.billingInfo?.billingEmail || clientDoc.email || '')
      setPaymentMethod(obData?.billingInfo?.paymentMethod || 'ach')
      setSignerPhone(obData?.billingInfo?.signerPhone || clientDoc.phoneNumber || '')
      setSignatoryTitle(obData?.signatoryTitle || '')
      setSkipAgreements(Boolean(obData?.skipAgreements || clientDoc.skipAgreements))
      if (obData?.companyName && !clientDoc.companyName) {
        setCompanyName(obData.companyName)
      }

      // Fetch projects
      const projSnap = await getDocs(
        query(collection(db, 'projects'), where('clientId', '==', clientId))
      )
      setProjects(projSnap.docs.map((d) => ({ projectId: d.id, ...d.data() })).filter((p) => !p.deletedAt))

      // Fetch invoices
      const invSnap = await getDocs(
        query(collection(db, 'invoices'), where('clientId', '==', clientId))
      )
      setInvoices(invSnap.docs.map((d) => ({ invoiceId: d.id, ...d.data() })))
    } catch (err) {
      console.error(err)
      setError('Failed to fetch client details from database.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadClientData()
    if (!clientId) return undefined

    const unsub = onSnapshot(
      doc(db, 'clientOnboarding', clientId),
      (snap) => {
        if (!snap.exists()) return
        const data = snap.data()
        setOnboarding((prev) => ({
          ...(prev || {}),
          agreements: data.agreements || {},
          onboardingStatus: normalizeOnboardingStatus(data.onboardingStatus),
          skipAgreements: Boolean(data.skipAgreements),
          rejectionReason: data.rejectionReason ?? prev?.rejectionReason ?? null,
          submittedAt: data.submittedAt ?? prev?.submittedAt,
          updatedAt: data.updatedAt ?? prev?.updatedAt,
        }))
        if (typeof data.skipAgreements === 'boolean') {
          setSkipAgreements(Boolean(data.skipAgreements))
        }
      },
      (err) => {
        console.warn('Live onboarding listener failed:', err.message)
      }
    )

    return () => unsub()
  }, [clientId])

  const resolvedAgreements = resolveAgreements(onboarding?.agreementTexts)
  const activeContract =
    resolvedAgreements.find((a) => a.id === contractId) || resolvedAgreements[0]
  const activeContractSigned = Boolean(onboarding?.agreements?.[contractId]?.signed)

  const handleDownloadAgreementPdf = (agId, title, sigRecord) => {
    const resolved = resolvedAgreements.find((a) => a.id === agId)
    downloadAgreementRecordAsPDF({
      id: agId,
      title: title || resolved?.title,
      content: resolved?.content,
      sigRecord,
      clientName: companyName || client?.companyName || client?.displayName,
    })
  }

  // Load the selected agreement into the editor whenever the client or selection changes
  useEffect(() => {
    if (!activeContract) return
    setContractDraft({
      title: activeContract.title,
      summary: activeContract.summary,
      content: activeContract.content,
    })
    setContractDirty(false)
  }, [contractId, onboarding])

  const handleSaveContract = async () => {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await updateClientAgreementText(
        clientId,
        contractId,
        contractDraft,
        onboarding?.agreements || {}
      )
      setSuccess(`${contractId.toUpperCase()} wording saved for this client.`)
      setContractDirty(false)
      await loadClientData()
    } catch (err) {
      console.error(err)
      setError(err.message || 'Failed to save the contract wording.')
    } finally {
      setSaving(false)
    }
  }

  const handleRestoreStandardContract = () => {
    const standard = DEFAULT_AGREEMENTS.find((a) => a.id === contractId)
    if (!standard) return
    setContractDraft({
      title: standard.title,
      summary: standard.summary,
      content: standard.content,
    })
    setContractDirty(true)
  }

  const handleApproveClient = async () => {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await approveClientOnboarding(clientId)
      setSuccess(`Client "${displayName || companyName}" has been APPROVED! Full portal access is unlocked.`)
      setStatus('active')
      setOnboarding((prev) => ({ ...prev, onboardingStatus: 'approved' }))
      loadClientData()
    } catch (err) {
      console.error(err)
      setError(err.message || 'Failed to approve client.')
    } finally {
      setSaving(false)
    }
  }

  const handleRejectClient = async (e) => {
    e.preventDefault()
    if (!rejectReason.trim()) {
      setError('Please provide a reason or instruction for the client.')
      return
    }

    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await rejectClientOnboarding(clientId, rejectReason.trim())
      setSuccess('Re-submission request sent to client.')
      setShowRejectModal(false)
      setOnboarding((prev) => ({
        ...prev,
        onboardingStatus: 'rejected',
        rejectionReason: rejectReason.trim(),
        agreements: {},
      }))
      loadClientData()
    } catch (err) {
      console.error(err)
      setError(err.message || 'Failed to request re-submission.')
    } finally {
      setSaving(false)
    }
  }

  const handleUpdateProfile = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')

    try {
      await updateClientInDb(clientId, {
        displayName,
        companyName,
        phoneNumber,
        status,
        notes,
      })
      await updateClientBillingProfile(clientId, {
        companyName,
        signatoryTitle,
        billingEmail,
        billingAddress,
        taxId,
        paymentMethod,
        signerPhone,
      })
      const previousSkip = Boolean(onboarding?.skipAgreements || client?.skipAgreements)
      if (skipAgreements !== previousSkip) {
        const waiver = await setClientAgreementsWaiver(
          clientId,
          skipAgreements,
          auth.currentUser?.uid || 'admin',
          onboarding?.agreements || {}
        )
        setOnboarding((prev) => ({ ...(prev || {}), ...waiver }))
        if (skipAgreements) {
          setStatus('active')
        }
      }
      setSuccess(
        skipAgreements && skipAgreements !== previousSkip
          ? 'Client can log in with the credentials you created. Agreement signing is not required.'
          : 'Client profile and billing details updated.'
      )
      await loadClientData()
    } catch (err) {
      console.error(err)
      setError('Failed to update client profile.')
    } finally {
      setSaving(false)
    }
  }

  const handleSetPassword = async () => {
    if (!newPassword || newPassword.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await setClientPassword(clientId, newPassword)
      setNewPassword('')
      setSuccess('Password updated. The client signs in with their username and this password.')
    } catch (err) {
      console.error(err)
      setError(err.message || 'Failed to update password.')
    } finally {
      setSaving(false)
    }
  }

  const handleSendResetEmail = async () => {
    if (!client?.email) return
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      if (import.meta.env.VITE_FIREBASE_API_KEY !== 'mock_api_key_dev') {
        await sendPasswordResetEmail(auth, client.email)
        setSuccess(`Password reset email sent to ${client.email}!`)
      } else {
        setSuccess(`[Mock Mode] Simulated password reset email sent to ${client.email}`)
      }
    } catch (err) {
      console.error(err)
      setError(err.message || 'Failed to send password reset email.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <LocalSpinner />
  }

  const obStatus = normalizeOnboardingStatus(onboarding?.onboardingStatus || client?.onboardingStatus)
  const contractList = [
    { id: 'msa', short: 'MSA', name: 'Master Services Agreement' },
    { id: 'nda', short: 'NDA', name: 'Mutual Non-Disclosure Agreement' },
    { id: 'sow', short: 'SOW', name: 'Statement of Work' },
  ]
  const signedContractCount = contractList.filter((ag) => onboarding?.agreements?.[ag.id]?.signed).length

  return (
    <div className="space-y-6 w-full text-fg">
      {/* Header with Back button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            to="/crm/contacts"
            className="p-2 bg-canvas hover:bg-surface text-fg rounded-xl transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <PageHeader
            title={`Manage Client: ${client?.displayName || client?.companyName || 'Client User'}`}
            description={`Compliance verification, signed contracts, and account settings for ${client?.companyName || 'Corporate Client'}`}
          />
        </div>

        {/* Status Badge */}
        <div>
          {obStatus === 'approved' ? (
            <Badge variant="success" className="px-3 py-1.5 text-xs flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4" />{' '}
              {onboarding?.skipAgreements || skipAgreements ? 'Agreements waived · Active' : 'Approved & Active'}
            </Badge>
          ) : obStatus === 'pending_approval' ? (
            <Badge variant="warning" className="px-3 py-1.5 text-xs flex items-center gap-1.5 bg-amber-500/10 text-amber-500 border-amber-500/30">
              <Clock className="w-4 h-4" /> Signatures Pending Approval
            </Badge>
          ) : obStatus === 'rejected' ? (
            <Badge variant="danger" className="px-3 py-1.5 text-xs flex items-center gap-1.5">
              <XCircle className="w-4 h-4" /> Re-submission Requested
            </Badge>
          ) : (
            <Badge variant="neutral" className="px-3 py-1.5 text-xs flex items-center gap-1.5">
              <Clock className="w-4 h-4" /> Awaiting Client Signatures
            </Badge>
          )}
        </div>
      </div>

      {error && (
        <div className="p-4 bg-rose-500/10 text-rose-500 rounded-xl border border-rose-500/20 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="p-4 bg-emerald-500/10 text-emerald-500 rounded-xl border border-emerald-500/20 text-xs flex items-center gap-2">
          <CheckCircle className="w-4 h-4" />
          <span>{success}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-border pb-3">
        <button
          onClick={() => setActiveTab('compliance')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
            activeTab === 'compliance'
              ? 'bg-accent/15 text-accent border border-accent/30'
              : 'text-muted hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <ShieldCheck className="w-4 h-4" /> Compliance & Signed Agreements
        </button>
        <button
          onClick={() => setActiveTab('contracts')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
            activeTab === 'contracts'
              ? 'bg-accent/15 text-accent border border-accent/30'
              : 'text-muted hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <FileSignature className="w-4 h-4" /> Legal Contracts
        </button>
        <button
          onClick={() => setActiveTab('details')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
            activeTab === 'details'
              ? 'bg-accent/15 text-accent border border-accent/30'
              : 'text-muted hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <User className="w-4 h-4" /> Profile & Account Settings
        </button>
      </div>

      {/* TAB 1: COMPLIANCE & ONBOARDING DOCUMENTS */}
      {activeTab === 'compliance' && (
        <div className="space-y-6">
          <Card className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="font-semibold text-sm text-fg flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-accent" /> Onboarding review
              </h3>
              <p className="text-xs text-muted mt-1">
                Check contracts and billing, then approve workspace access.
              </p>
              {(onboarding?.skipAgreements || skipAgreements) && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-2">
                  Agreements waived by admin. This client can log in without signing MSA, NDA, or SOW.
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {obStatus !== 'approved' ? (
                <>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => setShowRejectModal(true)}
                    disabled={saving}
                    icon={XCircle}
                  >
                    Request re-signature
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleApproveClient}
                    disabled={saving}
                    className="bg-emerald-600 hover:bg-emerald-500 shadow-md shadow-emerald-600/20"
                    icon={Check}
                  >
                    Approve account
                  </Button>
                </>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-2.5 py-1.5 rounded-lg">
                  <Check className="w-3.5 h-3.5" /> Access active
                </span>
              )}
            </div>
          </Card>

          <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
            <Card className="p-0 xl:col-span-3 overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border">
                <h4 className="text-sm font-semibold text-fg flex items-center gap-2">
                  <FileCheck2 className="w-4 h-4 text-accent" /> Contracts
                </h4>
                <span className="text-[11px] font-medium text-muted">
                  {signedContractCount} of {contractList.length} signed
                </span>
              </div>
              <div>
                {contractList.map((ag, idx) => {
                  const sig = onboarding?.agreements?.[ag.id]
                  const signed = Boolean(sig?.signed)
                  return (
                    <div
                      key={ag.id}
                      className={`px-5 py-4 flex flex-col gap-3 sm:flex-row sm:items-center ${
                        idx < contractList.length - 1 ? 'border-b border-slate-100 dark:border-border/80' : ''
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-fg">{ag.name}</p>
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                            {ag.short}
                          </span>
                          {signed ? (
                            <CheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                          ) : (
                            <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          )}
                        </div>
                        {signed ? (
                          <p className="text-[11px] text-muted mt-1 truncate">
                            {sig.signatoryName}
                            {sig.signatoryTitle ? ` · ${sig.signatoryTitle}` : ''}
                            {' · '}
                            {sig.timestampFormatted || sig.signedAt}
                          </p>
                        ) : (
                          <p className="text-[11px] text-slate-400 mt-1">Awaiting signature</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {signed && sig.signatureDataUrl && (
                          <img
                            src={sig.signatureDataUrl}
                            alt=""
                            className="h-7 max-w-[88px] px-1.5 py-0.5 rounded-md bg-white border border-slate-200 dark:border-slate-700 object-contain"
                          />
                        )}
                        {signed && (
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={Eye}
                            onClick={() => setPreviewAgreement({ id: ag.id, title: ag.name, sigRecord: sig })}
                          >
                            View
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant={signed ? 'primary' : 'secondary'}
                          icon={Download}
                          onClick={() => handleDownloadAgreementPdf(ag.id, ag.name, sig)}
                        >
                          PDF
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>

            <Card className="p-0 xl:col-span-2 overflow-hidden">
              <div className="px-5 py-4 border-b border-border">
                <h4 className="text-sm font-semibold text-fg flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-emerald-500" /> Billing
                </h4>
              </div>
              {onboarding?.billingInfo ? (
                <dl>
                  {[
                    { label: 'Entity', value: onboarding.companyName || client?.companyName },
                    { label: 'Email', value: onboarding.billingInfo.billingEmail },
                    { label: 'Address', value: onboarding.billingInfo.billingAddress },
                    { label: 'Tax ID / GST', value: onboarding.billingInfo.taxId },
                    { label: 'Payment', value: onboarding.billingInfo.paymentMethod?.toUpperCase() },
                    { label: 'Accounts contact', value: onboarding.billingInfo.signerPhone },
                  ].map((row, idx, arr) => (
                    <div
                      key={row.label}
                      className={`px-5 py-3 grid grid-cols-[7.5rem_1fr] gap-3 ${
                        idx < arr.length - 1 ? 'border-b border-slate-100 dark:border-border/80' : ''
                      }`}
                    >
                      <dt className="text-[11px] text-muted pt-0.5">{row.label}</dt>
                      <dd className="text-xs font-medium text-fg break-words">
                        {row.value || <span className="text-slate-400 font-normal">—</span>}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="px-5 py-8 text-xs text-muted">
                  No billing profile yet. Add details on Profile &amp; Account Settings.
                </p>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* TAB 2: PER-CLIENT LEGAL CONTRACT WORDING */}
      {activeTab === 'contracts' && (
        <div className="space-y-6">
          <Card className="p-5 border-border bg-slate-900/50">
            <h3 className="font-bold text-sm text-fg flex items-center gap-2">
              <FileSignature className="w-4 h-4 text-accent" /> Tailor the Agreements for This Client
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Each client starts from our standard wording. Edit any agreement here to match the work this client
              engaged us for. Once the client signs an agreement, its wording is locked.
            </p>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* Agreement selector */}
            <div className="lg:col-span-1 space-y-3">
              {resolvedAgreements.map((ag) => {
                const isSelected = contractId === ag.id
                const isSigned = Boolean(onboarding?.agreements?.[ag.id]?.signed)

                return (
                  <button
                    key={ag.id}
                    type="button"
                    onClick={() => setContractId(ag.id)}
                    className={`w-full p-4 rounded-xl border text-left transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-accent/15 border-accent shadow-sm'
                        : 'bg-surface/40 border-border hover:border-border'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="font-bold text-xs text-fg">{ag.shortName}</span>
                      {isSigned ? (
                        <Badge variant="success" className="text-[10px] flex items-center gap-1">
                          <Lock className="w-3 h-3" /> Signed
                        </Badge>
                      ) : ag.customized ? (
                        <Badge variant="warning" className="text-[10px] bg-amber-500/10 text-amber-500 border-amber-500/30">
                          Customized
                        </Badge>
                      ) : (
                        <Badge variant="neutral" className="text-[10px]">Standard</Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-muted leading-snug">{ag.title}</p>
                  </button>
                )
              })}

              <div className="p-3 rounded-xl bg-accent-soft border border-accent/20 text-[11px] text-accent flex items-start gap-2">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>Edits apply to this client only. Other clients keep the standard wording.</span>
              </div>
            </div>

            {/* Editor */}
            <Card className="lg:col-span-3 p-6 border-border space-y-4">
              {activeContractSigned ? (
                <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-600 dark:text-emerald-300 flex items-start gap-2.5">
                  <Lock className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold">This agreement has been signed and is now locked.</p>
                    <p className="mt-1">
                      Signed by {onboarding?.agreements?.[contractId]?.signatoryName || 'the client'} on{' '}
                      {onboarding?.agreements?.[contractId]?.timestampFormatted || 'record'}. The exact text they
                      signed is preserved and shown below.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between pb-3 border-b border-border">
                  <h4 className="font-bold text-xs uppercase tracking-wider text-muted flex items-center gap-2">
                    <PencilLine className="w-4 h-4 text-accent" /> Editing {activeContract?.shortName}
                  </h4>
                  {contractDirty && (
                    <Badge variant="warning" className="text-[10px] bg-amber-500/10 text-amber-500 border-amber-500/30">
                      Unsaved changes
                    </Badge>
                  )}
                </div>
              )}

              <Input
                label="Agreement Title"
                value={contractDraft.title}
                onChange={(e) => {
                  setContractDraft((p) => ({ ...p, title: e.target.value }))
                  setContractDirty(true)
                }}
                disabled={activeContractSigned}
              />

              <Input
                label="Short Summary (shown to the client above the contract)"
                value={contractDraft.summary}
                onChange={(e) => {
                  setContractDraft((p) => ({ ...p, summary: e.target.value }))
                  setContractDirty(true)
                }}
                disabled={activeContractSigned}
              />

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-fg">
                  Full Contract Text
                </label>
                <textarea
                  rows={20}
                  value={
                    activeContractSigned
                      ? onboarding?.agreements?.[contractId]?.signedContent || contractDraft.content
                      : contractDraft.content
                  }
                  onChange={(e) => {
                    setContractDraft((p) => ({ ...p, content: e.target.value }))
                    setContractDirty(true)
                  }}
                  disabled={activeContractSigned}
                  className="w-full bg-canvas border border-border text-fg text-xs leading-relaxed font-mono rounded-xl p-4 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all resize-y disabled:opacity-70 disabled:cursor-not-allowed"
                />
              </div>

              {!activeContractSigned && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-border">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleRestoreStandardContract}
                    disabled={saving}
                    icon={RotateCcw}
                  >
                    Restore Standard Wording
                  </Button>

                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={handleSaveContract}
                    disabled={saving || !contractDirty}
                    className="bg-accent hover:bg-accent-hover"
                    icon={Save}
                  >
                    {saving ? 'Saving...' : `Save ${activeContract?.shortName} for This Client`}
                  </Button>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* TAB 3: PROFILE & ACCOUNT DETAILS */}
      {activeTab === 'details' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 space-y-6">
            <Card className="p-6 space-y-4 border-border text-center">
              <div className="w-20 h-20 rounded-2xl bg-emerald-100 dark:bg-emerald-600/20 text-emerald-600 dark:text-emerald-400 font-bold text-3xl flex items-center justify-center border border-emerald-200 dark:border-emerald-500/30 mx-auto">
                {client?.displayName?.charAt(0) || client?.companyName?.charAt(0) || 'C'}
              </div>
              <div>
                <h3 className="font-bold text-lg text-fg">{client?.displayName}</h3>
                <p className="text-xs text-muted flex items-center justify-center gap-1 mt-1">
                  <Building className="w-3.5 h-3.5" /> {client?.companyName}
                </p>
              </div>

              <div className="pt-3 border-t border-border flex justify-center">
                <Badge variant={status === 'active' ? 'success' : 'danger'}>
                  {status === 'active' ? 'Active Portal Access' : 'Access Suspended'}
                </Badge>
              </div>

              <div className="space-y-3 pt-4 text-left text-xs text-muted border-t border-border">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-slate-400" />
                  <span className="truncate">{clientLoginLabel(client)}</span>
                </div>
                {client?.phoneNumber && (
                  <div className="flex items-center gap-2">
                    <Phone className="w-4 h-4 text-slate-400" />
                    <span>{client?.phoneNumber}</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-slate-400" />
                  <span>Created: {new Date(client?.createdAt || Date.now()).toLocaleDateString()}</span>
                </div>
              </div>
            </Card>

            <Card className="p-6 space-y-4 border-border">
              <h4 className="font-bold text-xs uppercase tracking-wider text-muted">Security & Credentials</h4>
              {client?.username || isSyntheticClientEmail(client?.email) ? (
                <>
                  <p className="text-xs text-muted">
                    This account signs in with a username and password. Set a new password here.
                  </p>
                  <Input
                    label="New Password"
                    type="password"
                    placeholder="Minimum 8 characters"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleSetPassword}
                    disabled={saving}
                    className="w-full text-xs text-accent border-accent/20"
                    icon={Lock}
                  >
                    Set New Password
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-xs text-muted">
                    Trigger a password reset email for this client representative.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleSendResetEmail}
                    disabled={saving}
                    className="w-full text-xs text-accent border-accent/20"
                    icon={Lock}
                  >
                    Send Password Reset Email
                  </Button>
                </>
              )}
            </Card>
          </div>

          <div className="lg:col-span-2 space-y-6">
            <Card className="p-6 border-border space-y-4">
              <h3 className="font-bold text-fg text-sm">Account Details & Configurations</h3>

              <form onSubmit={handleUpdateProfile} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input
                    label="Client Contact Name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    icon={User}
                    required
                  />
                  <Input
                    label="Company Name"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    icon={Building}
                    required
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input
                    label="Phone Number"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    icon={Phone}
                  />
                  <div className="space-y-1.5 text-left">
                    <label className="block text-xs font-medium text-fg">Account Access State</label>
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                      className="w-full bg-canvas border border-border text-fg text-sm rounded-xl py-2.5 px-3.5 focus:outline-none focus:border-accent transition-colors cursor-pointer"
                    >
                      <option value="active">Active Access Granted</option>
                      <option value="suspended">Suspended / Deactivated</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5 text-left">
                  <label className="block text-xs font-medium text-fg">Internal CRM Account Notes</label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Internal notes about the client..."
                    rows={4}
                    className="w-full bg-canvas border border-border text-fg text-xs rounded-xl p-3 focus:outline-none focus:border-accent transition-colors"
                  />
                </div>

                <div className="rounded-xl border border-border bg-canvas p-4 space-y-2">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={skipAgreements}
                      onChange={(e) => setSkipAgreements(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-accent focus:ring-accent"
                    />
                    <span>
                      <span className="block text-xs font-medium text-fg">
                        This client does not need to sign agreements
                      </span>
                      <span className="block text-[11px] text-muted mt-0.5">
                        They can log in with the credentials you created. MSA, NDA, and SOW will not be required.
                      </span>
                    </span>
                  </label>
                </div>

                <div className="pt-4 border-t border-border space-y-4">
                  <h4 className="font-bold text-xs uppercase tracking-wider text-muted">Billing, GST &amp; Address</h4>
                  <p className="text-[11px] text-muted">
                    Update these anytime. Clients see them on their Billing page.
                  </p>

                  <Input
                    label="Tax ID / GST Number"
                    placeholder="e.g. 29AAAAA0000A1Z5"
                    value={taxId}
                    onChange={(e) => setTaxId(e.target.value)}
                  />

                  <div className="space-y-1.5 text-left">
                    <label className="block text-xs font-medium text-fg">Registered Billing Address</label>
                    <textarea
                      value={billingAddress}
                      onChange={(e) => setBillingAddress(e.target.value)}
                      placeholder="Street, city, state, PIN"
                      rows={3}
                      className="w-full bg-canvas border border-border text-fg text-xs rounded-xl p-3 focus:outline-none focus:border-accent transition-colors"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Input
                      label="Billing Email"
                      type="email"
                      placeholder="ap@client.com"
                      value={billingEmail}
                      onChange={(e) => setBillingEmail(e.target.value)}
                    />
                    <Input
                      label="Accounts Contact Phone"
                      value={signerPhone}
                      onChange={(e) => setSignerPhone(e.target.value)}
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Input
                      label="Signatory Title"
                      placeholder="e.g. Director of Operations"
                      value={signatoryTitle}
                      onChange={(e) => setSignatoryTitle(e.target.value)}
                    />
                    <div className="space-y-1.5 text-left">
                      <label className="block text-xs font-medium text-fg">Preferred Payment Method</label>
                      <select
                        value={paymentMethod}
                        onChange={(e) => setPaymentMethod(e.target.value)}
                        className="w-full bg-canvas border border-border text-fg text-sm rounded-xl py-2.5 px-3.5 focus:outline-none focus:border-accent transition-colors cursor-pointer"
                      >
                        <option value="ach">Bank transfer / ACH</option>
                        <option value="wire">International wire</option>
                        <option value="card">Card</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <Button
                    type="submit"
                    variant="primary"
                    className="bg-accent hover:bg-accent-hover px-6"
                    icon={Save}
                    disabled={saving}
                  >
                    {saving ? 'Saving...' : 'Save Profile Changes'}
                  </Button>
                </div>
              </form>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="p-5 border-border space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-xs uppercase tracking-wider text-muted flex items-center gap-1.5">
                    <Briefcase className="w-3.5 h-3.5" /> Associated Projects
                  </h4>
                  <Badge variant="neutral">{projects.length}</Badge>
                </div>

                {projects.length === 0 ? (
                  <p className="text-xs text-muted py-4 text-center">No active projects linked to this client.</p>
                ) : (
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {projects.map((p) => (
                      <div key={p.projectId} className="p-2 bg-canvas/50 border border-slate-100 dark:border-border rounded-lg flex items-center justify-between text-xs">
                        <span className="font-semibold text-fg truncate pr-2">{p.name}</span>
                        <Badge variant="brand">{p.completionPercent || 0}%</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <Card className="p-5 border-border space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-xs uppercase tracking-wider text-muted flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5" /> Billing & Invoices
                  </h4>
                  <Badge variant="neutral">{invoices.length}</Badge>
                </div>

                {invoices.length === 0 ? (
                  <p className="text-xs text-muted py-4 text-center">No billing details or invoices found.</p>
                ) : (
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {invoices.map((i) => (
                      <div key={i.invoiceId} className="p-2 bg-canvas/50 border border-slate-100 dark:border-border rounded-lg flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-800 font-mono">{i.invoiceNumber || 'INV-001'}</span>
                        <span className="font-bold">${(i.total || 0).toLocaleString()}</span>
                        <Badge variant={i.status === 'paid' ? 'success' : 'warning'}>{i.status}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          </div>
        </div>
      )}

      {/* SIGNED CONTRACT & LEGAL CERTIFICATE MODAL */}
      {previewAgreement && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-border rounded-2xl max-w-3xl w-full p-6 space-y-4 shadow-2xl text-fg max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-accent" />
                <div>
                  <h3 className="font-bold text-fg text-sm">{previewAgreement.title}</h3>
                  <p className="text-[11px] text-emerald-400 font-medium">Legally Executed E-Signature Certificate</p>
                </div>
              </div>
              <button
                onClick={() => setPreviewAgreement(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-fg hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Agreement Content */}
            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              <div className="bg-slate-950 p-4 rounded-xl border border-border text-xs font-mono text-slate-300 whitespace-pre-wrap leading-relaxed">
                {previewAgreement.sigRecord?.signedContent ||
                  resolvedAgreements.find((a) => a.id === previewAgreement.id)?.content ||
                  'Agreement text content...'}
              </div>

              {/* Execution Certificate Stamp */}
              <div className="bg-emerald-950/20 border border-emerald-500/30 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1 text-xs">
                  <div className="flex items-center gap-1.5 text-emerald-400 font-bold">
                    <CheckCircle className="w-4 h-4" /> Digital E-Signature Validated
                  </div>
                  <p className="text-slate-300">
                    Signatory: <strong className="text-fg">{previewAgreement.sigRecord?.signatoryName}</strong> ({previewAgreement.sigRecord?.signatoryTitle || 'Representative'})
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Execution Timestamp: {previewAgreement.sigRecord?.timestampFormatted || previewAgreement.sigRecord?.signedAt}
                  </p>
                </div>

                {previewAgreement.sigRecord?.signatureDataUrl && (
                  <div className="text-center space-y-1">
                    <img
                      src={previewAgreement.sigRecord.signatureDataUrl}
                      alt="Signature Seal"
                      className="h-12 px-3 py-1 bg-slate-900 rounded-lg border border-slate-700 object-contain mx-auto"
                    />
                    <span className="text-[10px] text-muted">Signatory Seal</span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-border shrink-0">
              <Button variant="secondary" size="sm" onClick={() => setPreviewAgreement(null)}>
                Close
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() =>
                  handleDownloadAgreementPdf(
                    previewAgreement.id,
                    previewAgreement.title,
                    previewAgreement.sigRecord
                  )
                }
                className="bg-accent hover:bg-accent-hover"
                icon={Download}
              >
                Download PDF
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* RE-SUBMISSION FEEDBACK MODAL */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-border rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3 text-rose-400">
              <AlertTriangle className="w-6 h-6" />
              <h3 className="font-bold text-fg text-base">Request Re-signature</h3>
            </div>
            <p className="text-xs text-slate-400">
              Specify what needs correction (e.g. signed by someone without authority, wrong designation recorded). The client will see this feedback when logging in and can sign again.
            </p>

            <textarea
              rows={4}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. The SOW was signed under the wrong designation. Please re-sign as an authorized signatory."
              className="w-full bg-slate-950 border border-border text-fg text-xs rounded-xl p-3 focus:outline-none focus:border-rose-500 resize-none"
            />

            <div className="flex justify-end gap-3 pt-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowRejectModal(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleRejectClient}
                disabled={saving || !rejectReason.trim()}
                icon={XCircle}
              >
                {saving ? 'Submitting...' : 'Send Request to Client'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
