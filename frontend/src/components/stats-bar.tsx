'use client'

import { api } from '@/lib/api'
import { useEffect, useState } from 'react'

type ViewMode = 'all' | 'p2p'

interface Stats {
  totalTrades: number
  tradesPerHour: number
  lifiSwaps: number
  totalVolume: number
  totalPnl?: number | null
}

interface StatsBarProps {
  viewMode: ViewMode
  botAddress?: string | null
}

export function StatsBar({ viewMode, botAddress }: StatsBarProps) {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchStats() {
      try {
        const params = new URLSearchParams()
        if (botAddress) params.set('botAddress', botAddress)

        const res = await api.get(`/api/deals/stats?${params.toString()}`)
        const s = res.data.stats

        // Apply viewMode filter for display purposes
        // (backend returns totals; p2p filter is client-side for now)
        setStats({
          totalTrades: s.totalTrades,
          tradesPerHour: s.tradesPerHour,
          lifiSwaps: s.lifiSwaps,
          totalVolume: s.totalVolume,
          totalPnl: s.totalPnl ?? null,
        })
      } catch (error) {
        console.error('Failed to fetch stats:', error)
      } finally {
        setLoading(false)
      }
    }

    setLoading(true)
    fetchStats()
    const interval = setInterval(fetchStats, 30000)
    return () => clearInterval(interval)
  }, [botAddress])

  if (loading || !stats) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-card border border-border rounded-lg p-4 animate-pulse">
            <div className="h-4 bg-muted rounded w-20 mb-2"></div>
            <div className="h-6 bg-muted rounded w-32"></div>
          </div>
        ))}
      </div>
    )
  }

  const showPnl = botAddress && stats.totalPnl !== null && stats.totalPnl !== undefined
  const pnlPositive = showPnl && stats.totalPnl! >= 0

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
      {/* Trades/Hour */}
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span>TRADES/HOUR</span>
        </div>
        <div className="font-mono font-semibold text-lg text-foreground">
          {Math.round(stats.tradesPerHour)}
          <span className="text-muted-foreground text-sm ml-2">trades</span>
        </div>
      </div>

      {/* Total Trades */}
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <span>TOTAL TRADES</span>
        </div>
        <div className="font-mono font-semibold text-lg text-foreground">
          {Math.round(stats.totalTrades).toLocaleString()}
          <span className="text-muted-foreground text-sm ml-2">({Math.round(stats.tradesPerHour)}/hr)</span>
        </div>
      </div>

      {/* LI.FI Swaps */}
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
          <span>LI.FI SWAPS</span>
        </div>
        <div className="font-mono font-semibold text-lg text-foreground">
          {stats.lifiSwaps} <span className="text-muted-foreground text-sm">swaps</span>
        </div>
      </div>

      {/* Total Volume → PNL when bot is selected */}
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
          <span>{showPnl ? 'PNL' : 'TOTAL VOLUME'}</span>
        </div>
        <div className="font-mono font-semibold text-lg text-foreground">
          {showPnl ? (
            <>
              <span className={pnlPositive ? 'text-green-500' : 'text-red-500'}>
                {pnlPositive ? '+' : ''}{stats.totalPnl!.toLocaleString()}
              </span>
              <span className="text-muted-foreground text-sm ml-1">USD</span>
            </>
          ) : (
            <>
              ${Math.round(stats.totalVolume).toLocaleString()} <span className="text-muted-foreground text-sm">USDC</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
