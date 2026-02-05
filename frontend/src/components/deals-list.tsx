'use client'

import { api } from '@/lib/api'
import Link from 'next/link'
import { useEffect, useState } from 'react'

interface Deal {
  id: string
  type: 'buy' | 'sell'
  tokenPair: string
  price: number
  amount: number
  total: number
  maker: { id: string; name: string; ensName?: string }
  taker: { id: string; name: string; ensName?: string }
  executedAt: string
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

  function truncateId(id: string) {
    if (id.length <= 12) return id
    return `${id.slice(0, 8)}...${id.slice(-4)}`
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
                {/* Left: Deal ID & Time */}
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded bg-green-500/20 flex items-center justify-center text-xs font-bold text-green-500">
                    ✓
                  </div>
                  <div>
                    <div className="font-mono text-primary text-sm">
                      {truncateId(deal.id)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {timeAgo(deal.executedAt)}
                    </div>
                  </div>
                </div>

                {/* Middle: From → To */}
                <div className="hidden md:block w-44 text-sm">
                  <div className="flex">
                    <span className="text-muted-foreground w-12">From</span>
                    <Link
                      href={`/wallet/${deal.maker.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-primary truncate hover:underline"
                    >
                      {deal.maker.ensName || deal.maker.name}
                    </Link>
                  </div>
                  <div className="flex">
                    <span className="text-muted-foreground w-12">To</span>
                    <Link
                      href={`/wallet/${deal.taker.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-chart-2 truncate hover:underline"
                    >
                      {deal.taker.ensName || deal.taker.name}
                    </Link>
                  </div>
                </div>

                {/* Right: Amount */}
                <div className="text-right">
                  <div className="font-mono text-sm">
                    {deal.amount} {deal.tokenPair.split('/')[0]}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    ${deal.total.toLocaleString()}
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
