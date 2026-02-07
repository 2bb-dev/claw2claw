'use client'

import { api } from '@/lib/api'
import Link from 'next/link'
import { useEffect, useState } from 'react'

interface Deal {
  id: string
  txHash?: string
  regime?: string
  chainId?: number
  fromToken: string
  toToken: string
  fromAmount: string
  toAmount: string
  botAddress: string
  status: string
  createdAt: string
}

export function DealsList() {
  const [deals, setDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchDeals() {
      try {
        const res = await api.get('/api/deals')
        setDeals(res.data.deals || [])
      } catch (error) {
        console.error('Failed to fetch deals:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchDeals()
    const interval = setInterval(fetchDeals, 10000)
    return () => clearInterval(interval)
  }, [])

  function timeAgo(dateString: string) {
    const seconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000)
    if (seconds < 60) return `${seconds} secs ago`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes} min ago`
    const hours = Math.floor(minutes / 60)
    return `${hours}h ago`
  }

  function truncateAddress(addr: string) {
    if (addr.length <= 12) return addr
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`
  }

  return (
    <div className="bg-card border border-border rounded-lg">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="font-semibold text-foreground">Latest Deals</h3>
      </div>

      {/* List */}
      <div className="divide-y divide-border">
        {loading ? (
          <div className="text-center text-muted-foreground py-12">Loading...</div>
        ) : deals.length === 0 ? (
          <div className="text-center text-muted-foreground py-12">
            No deals yet
          </div>
        ) : (
          deals.slice(0, 6).map((deal) => (
            <Link
              key={deal.id}
              href={`/deals/${deal.id}`}
              className="block px-4 py-3 hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-center justify-between">
                {/* Left: Status & Time */}
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded flex items-center justify-center text-xs font-bold ${
                    deal.status === 'completed' ? 'bg-green-500/20 text-green-500' : 'bg-yellow-500/20 text-yellow-500'
                  }`}>
                    {deal.status === 'completed' ? '✓' : '⏳'}
                  </div>
                  <div>
                    <div className="font-mono text-primary text-sm">
                      {deal.txHash && !deal.txHash.startsWith('pending-')
                        ? truncateAddress(deal.txHash)
                        : `#${deal.id.slice(0, 8)}`}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {timeAgo(deal.createdAt)}
                    </div>
                  </div>
                </div>

                {/* Middle: Swap info */}
                <div className="hidden md:block w-44 text-sm">
                  <div className="text-foreground">
                    {deal.fromToken} → {deal.toToken}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Bot {truncateAddress(deal.botAddress)}
                  </div>
                </div>

                {/* Right: Amount */}
                <div className="text-right">
                  <div className="font-mono text-sm">
                    {deal.fromAmount} {deal.fromToken}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    → {deal.toAmount} {deal.toToken}
                  </div>
                </div>
              </div>
            </Link>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-border">
        <Link
          href="/deals"
          className="text-sm text-muted-foreground hover:text-primary transition-colors flex items-center justify-center gap-1"
        >
          VIEW ALL DEALS →
        </Link>
      </div>
    </div>
  )
}
