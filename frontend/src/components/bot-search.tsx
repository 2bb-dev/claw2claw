'use client'

import { api } from '@/lib/api'
import { useCallback, useState } from 'react'

interface BotSearchProps {
  onBotResolved: (botAddress: string | null, label: string | null) => void
  initialValue?: string | null
}

export function BotSearch({ onBotResolved, initialValue }: BotSearchProps) {
  const [input, setInput] = useState(initialValue || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resolvedLabel, setResolvedLabel] = useState<string | null>(initialValue || null)

  const isWalletAddress = (value: string) => /^0x[a-fA-F0-9]{40}$/.test(value)
  const isEnsName = (value: string) => value.includes('.')

  const handleSearch = useCallback(async () => {
    const trimmed = input.trim()
    if (!trimmed) {
      // Clear — revert to platform view
      setError(null)
      setResolvedLabel(null)
      onBotResolved(null, null)
      return
    }

    setLoading(true)
    setError(null)

    try {
      if (isWalletAddress(trimmed)) {
        // Direct wallet address — no resolution needed
        setResolvedLabel(trimmed)
        onBotResolved(trimmed, trimmed)
      } else if (isEnsName(trimmed)) {
        // ENS name — resolve via backend
        const res = await api.post('/api/bots/ens/resolve', { ensName: trimmed })
        if (res.data.success && res.data.address) {
          setResolvedLabel(trimmed)
          onBotResolved(res.data.address, trimmed)
        } else {
          setError(`Could not resolve "${trimmed}"`)
        }
      } else {
        // Assume it's a subdomain shortcut, append .claw2claw.eth
        const fullName = `${trimmed}.claw2claw.eth`
        const res = await api.post('/api/bots/ens/resolve', { ensName: fullName })
        if (res.data.success && res.data.address) {
          setResolvedLabel(fullName)
          onBotResolved(res.data.address, fullName)
        } else {
          setError(`Could not resolve "${fullName}"`)
        }
      }
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'Resolution failed'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [input, onBotResolved])

  const handleClear = () => {
    setInput('')
    setError(null)
    setResolvedLabel(null)
    onBotResolved(null, null)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch()
  }

  return (
    <div className="max-w-xl mx-auto mb-8">
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
          {loading ? (
            <svg className="w-5 h-5 text-muted-foreground animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-5 h-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          )}
        </div>

        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search bot by ENS name or wallet address..."
          className="w-full pl-12 pr-20 py-3 bg-card border border-border rounded-lg text-foreground placeholder:text-muted-foreground font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
        />

        <div className="absolute inset-y-0 right-0 flex items-center gap-1 pr-3">
          {resolvedLabel && (
            <button
              onClick={handleClear}
              className="p-1 text-muted-foreground hover:text-foreground transition-colors"
              title="Clear"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
          <button
            onClick={handleSearch}
            disabled={loading || !input.trim()}
            className="px-3 py-1 bg-primary text-primary-foreground rounded text-xs font-semibold disabled:opacity-40 hover:opacity-90 transition-opacity"
          >
            Lookup
          </button>
        </div>
      </div>

      {/* Status line */}
      {error && (
        <p className="mt-2 text-xs text-destructive text-center">{error}</p>
      )}
      {resolvedLabel && !error && (
        <p className="mt-2 text-xs text-muted-foreground text-center">
          Showing stats for <span className="text-primary font-semibold">{resolvedLabel}</span>
        </p>
      )}
    </div>
  )
}
