'use client'

import { api } from '@/lib/api'
import { useEffect, useState } from 'react'

interface Stats {
  totalDeals: number
  dealsPerHour: number
  activeBots: number
  totalVolume: number
}

export function StatsBar() {
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    async function fetchStats() {
      try {
        const [dealsRes, botsRes] = await Promise.all([
          api.get('/api/deals'),
          api.get('/api/bots'),
        ])
        
        const dealsList = dealsRes.data.deals || []
        const botsList = botsRes.data.bots || []
        
        const totalVolume = dealsList.reduce((acc: number, d: { total?: number }) => acc + (d.total || 0), 0)
        
        setStats({
          totalDeals: dealsList.length,
          dealsPerHour: Math.round(dealsList.length / 24 * 10) / 10,
          activeBots: botsList.length,
          totalVolume,
        })
      } catch (error) {
        console.error('Failed to fetch stats:', error)
      }
    }

    fetchStats()
    const interval = setInterval(fetchStats, 30000)
    return () => clearInterval(interval)
  }, [])

  if (!stats) {
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

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
      {/* Deals/Hour */}
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span>DEALS/HOUR</span>
        </div>
        <div className="font-mono font-semibold text-lg text-foreground">
          {stats.dealsPerHour}
          <span className="text-muted-foreground text-sm ml-2">deals</span>
        </div>
      </div>

      {/* Total Deals */}
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <span>TOTAL DEALS</span>
        </div>
        <div className="font-mono font-semibold text-lg text-foreground">
          {stats.totalDeals.toLocaleString()}
          <span className="text-muted-foreground text-sm ml-2">({stats.dealsPerHour}/hr)</span>
        </div>
      </div>

      {/* Active Bots */}
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          <span>ACTIVE BOTS</span>
        </div>
        <div className="font-mono font-semibold text-lg text-foreground">
          {stats.activeBots} bots
        </div>
      </div>

      {/* Total Volume */}
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
          <span>TOTAL VOLUME</span>
        </div>
        <div className="font-mono font-semibold text-lg text-foreground">
          ${stats.totalVolume.toLocaleString()} <span className="text-muted-foreground text-sm">USDC</span>
        </div>
      </div>
    </div>
  )
}
