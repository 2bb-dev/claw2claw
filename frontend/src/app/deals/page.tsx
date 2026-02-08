'use client'

import { Header } from '@/components/header'
import { api } from '@/lib/api'
import { formatTokenAmount } from '@/lib/format'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'

interface Deal {
  id: string
  txHash?: string
  regime?: string
  chainId?: number
  fromToken: string
  toToken: string
  fromAmount: string
  toAmount: string
  fromTokenDecimals: number
  toTokenDecimals: number
  botAddress: string
  botEnsName?: string | null
  status: string
  createdAt: string
}

function truncateAddress(addr: string) {
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

function timeAgo(dateString: string) {
  const seconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000)
  if (seconds < 60) return `${seconds} secs ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function regimeLabel(regime?: string) {
  if (!regime) return 'P2P'
  if (regime.startsWith('lifi')) return 'LI.FI'
  return 'P2P'
}

function regimeStyle(regime?: string) {
  if (regime && regime.startsWith('lifi')) {
    return 'bg-purple-500/20 text-purple-400 border-purple-500/30'
  }
  return 'bg-blue-500/20 text-blue-400 border-blue-500/30'
}

export default function AllDealsPage() {
  return (
    <Suspense>
      <AllDealsContent />
    </Suspense>
  )
}

function AllDealsContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const botAddress = searchParams.get('botAddress')

  const [deals, setDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchDeals() {
      try {
        const params = new URLSearchParams()
        if (botAddress) params.set('botAddress', botAddress)
        const res = await api.get(`/api/deals?${params.toString()}`)
        setDeals(res.data.deals || [])
      } catch (error) {
        console.error('Failed to fetch deals:', error)
      } finally {
        setLoading(false)
      }
    }

    setLoading(true)
    fetchDeals()
    const interval = setInterval(fetchDeals, 10000)
    return () => clearInterval(interval)
  }, [botAddress])

  // Filter out failed deals for the public listing
  const visibleDeals = deals.filter((d) => botAddress || d.status !== 'failed')

  const heading = botAddress ? `Trades for ${truncateAddress(botAddress)}` : 'All Trades'
  return (
    <main className="min-h-screen bg-background">
      <Header />

      {/* Page header */}
      <div className="container mx-auto px-4 py-8">
        <button
          onClick={() => router.back()}
          className="text-sm text-muted-foreground hover:text-primary transition-colors mb-4 flex items-center gap-1"
        >
          ← Back
        </button>
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">{heading}</h1>
          <p className="text-sm text-muted-foreground">{visibleDeals.length} trades total</p>
        </div>

        {/* Trades list */}
        <div className="bg-card border border-border rounded-lg">
          <div className="divide-y divide-border">
            {loading ? (
              <div className="text-center text-muted-foreground py-16">Loading...</div>
            ) : visibleDeals.length === 0 ? (
              <div className="text-center text-muted-foreground py-16">No trades yet</div>
            ) : (
              visibleDeals.map((deal) => (
                <Link
                  key={deal.id}
                  href={`/deals/${deal.id}`}
                  className="block px-4 py-3 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    {/* Status icon */}
                    <div className={`w-8 h-8 rounded flex-shrink-0 flex items-center justify-center text-xs font-bold ${
                      deal.status === 'completed' ? 'bg-green-500/20 text-green-500' : deal.status === 'failed' ? 'bg-red-500/20 text-red-500' : 'bg-yellow-500/20 text-yellow-500'
                    }`}>
                      {deal.status === 'completed' ? '✓' : deal.status === 'failed' ? '✗' : '⏳'}
                    </div>

                    {/* Swap pair + bot identity */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground text-sm">
                          {deal.fromToken} → {deal.toToken}
                        </span>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${regimeStyle(deal.regime)}`}>
                          {regimeLabel(deal.regime)}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {deal.botEnsName ? (
                          <span className="text-primary">{deal.botEnsName}</span>
                        ) : (
                          truncateAddress(deal.botAddress)
                        )} · {timeAgo(deal.createdAt)}
                      </div>
                    </div>

                    {/* Amount */}
                    <div className="text-right flex-shrink-0">
                      <div className="font-mono text-sm">
                        {formatTokenAmount(deal.fromAmount, deal.fromTokenDecimals)} {deal.fromToken}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        → {deal.toAmount ? formatTokenAmount(deal.toAmount, deal.toTokenDecimals) : '...'} {deal.toToken}
                      </div>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
