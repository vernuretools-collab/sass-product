import React, { useState, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { PageHeader } from '../../components/layout/PageHeader'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { useUserStore } from '../../stores/userStore'
import { useMarketingStore } from './stores/marketingStore'
import { getCampaigns } from './services/marketingService'
import { Megaphone, Calendar, Link as LinkIcon, Copy, Check, Sparkles } from 'lucide-react'

export const UtmBuilder = () => {
  const { claims } = useUserStore()
  const orgId = claims?.orgId || ''

  const { campaigns, setCampaigns } = useMarketingStore()

  const [baseUrl, setBaseUrl] = useState('https://acme.businessos.io/landing')
  const [selectedCampaignId, setSelectedCampaignId] = useState('')
  const [source, setSource] = useState('linkedin')
  const [medium, setMedium] = useState('cpc')
  const [campaign, setCampaign] = useState('q3_enterprise')
  const [term, setTerm] = useState('')
  const [content, setContent] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const fetchRealCampaigns = async () => {
      const data = await getCampaigns(orgId)
      if (data) setCampaigns(data)
    }
    fetchRealCampaigns()
  }, [orgId, setCampaigns])

  const handleCampaignSelect = (campId) => {
    setSelectedCampaignId(campId)
    if (!campId) return

    const selected = campaigns.find((c) => c.campaignId === campId)
    if (selected) {
      if (selected.utmSource) setSource(selected.utmSource)
      if (selected.utmMedium) setMedium(selected.utmMedium)
      if (selected.utmCampaign) setCampaign(selected.utmCampaign)
    }
  }

  // Construct URL dynamically
  const buildUrl = () => {
    try {
      const url = new URL(baseUrl || 'https://company.com')
      if (source.trim()) url.searchParams.set('utm_source', source.trim())
      if (medium.trim()) url.searchParams.set('utm_medium', medium.trim())
      if (campaign.trim()) url.searchParams.set('utm_campaign', campaign.trim())
      if (term.trim()) url.searchParams.set('utm_term', term.trim())
      if (content.trim()) url.searchParams.set('utm_content', content.trim())
      return url.toString()
    } catch {
      let query = `?utm_source=${encodeURIComponent(source)}&utm_medium=${encodeURIComponent(medium)}&utm_campaign=${encodeURIComponent(campaign)}`
      if (term) query += `&utm_term=${encodeURIComponent(term)}`
      if (content) query += `&utm_content=${encodeURIComponent(content)}`
      return `${baseUrl}${query}`
    }
  }

  const generatedUrl = buildUrl()

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <div className="space-y-6">
      {/* Header & Sub Nav */}
      <div className="space-y-4">
        <PageHeader
          title="UTM Link Generator & Attribution Builder"
          description="Build clean, standardized campaign tracking URLs for ads, newsletters, and social posts to track lead acquisition."
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 space-y-4 border-border bg-surface">
          <div className="flex items-center justify-between pb-2 border-b border-border">
            <h3 className="text-sm font-bold text-fg">
              Link Parameters Configuration
            </h3>
            {campaigns.length > 0 && (
              <span className="text-xs text-accent font-medium flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" /> Quick Autofill
              </span>
            )}
          </div>

          {campaigns.length > 0 && (
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-fg">
                Link to Active Campaign (Optional)
              </label>
              <select
                value={selectedCampaignId}
                onChange={(e) => handleCampaignSelect(e.target.value)}
                className="w-full bg-canvas border border-border text-fg text-xs rounded-xl py-2.5 px-3.5 focus:outline-none cursor-pointer"
              >
                <option value="">-- Choose an existing campaign to prefill --</option>
                {campaigns.map((c) => (
                  <option key={c.campaignId} value={c.campaignId}>
                    {c.name} ({c.channel})
                  </option>
                ))}
              </select>
            </div>
          )}

          <Input
            label="Target Landing Page URL"
            placeholder="https://company.com/landing"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Campaign Source (utm_source)"
              placeholder="google, linkedin, newsletter"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
            <Input
              label="Campaign Medium (utm_medium)"
              placeholder="cpc, banner, email, organic"
              value={medium}
              onChange={(e) => setMedium(e.target.value)}
            />
          </div>

          <Input
            label="Campaign Name (utm_campaign)"
            placeholder="q3_enterprise_launch"
            value={campaign}
            onChange={(e) => setCampaign(e.target.value)}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Campaign Term (utm_term - optional)"
              placeholder="saas_software"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            />
            <Input
              label="Campaign Content (utm_content - optional)"
              placeholder="cta_button_blue"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </div>
        </Card>

        {/* Live URL Output Box */}
        <Card className="space-y-4 border-accent/30 bg-surface flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-fg">Generated Campaign URL</h3>
              {copied && (
                <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-200 dark:border-emerald-500/20 flex items-center gap-1 animate-pulse">
                  <Check className="w-3 h-3" /> Copied!
                </span>
              )}
            </div>
            <div className="p-3.5 rounded-xl bg-surface border border-accent/30 dark:border-border font-mono text-xs text-accent break-all leading-relaxed shadow-sm">
              {generatedUrl}
            </div>
            <p className="text-[11px] text-muted leading-relaxed">
              When leads click this custom link and sign up, UTM tags are automatically mapped directly to CRM lead records for multi-channel attribution.
            </p>
          </div>

          <Button
            variant="primary"
            className="w-full py-3"
            icon={copied ? Check : Copy}
            onClick={handleCopy}
          >
            {copied ? 'Copied URL to Clipboard!' : 'Copy Campaign Link'}
          </Button>
        </Card>
      </div>
    </div>
  )
}
