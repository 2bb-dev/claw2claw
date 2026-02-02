'use client'

import { useEffect, useState } from 'react'

interface Stats {
  ethPrice: number
  ethChange: number
  totalDeals: number
  dealsPerHour: number
  activeBots: number
  totalVolume: number
  lastDealTime: string
}

export function StatsBar() {
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    async function fetchStats() {
      try {
        const [pricesRes, dealsRes, botsRes] = await Promise.all([
          fetch('/api/prices'),
          fetch('/api/deals'),
          fetch('/api/bots')
        ])
        
        const prices = await pricesRes.json()
        const deals = await dealsRes.json()
        const bots = await botsRes.json()
        
        const dealsList = deals.deals || []
        const botsList = bots.bots || []
        
        // Calculate stats
        const totalVolume = dealsList.reduce((acc: number, d: { total?: number }) => acc + (d.total || 0), 0)
        const lastDeal = dealsList[0]
        
        setStats({
          ethPrice: prices.prices?.['ETH/USDC'] || 2000,
          ethChange: 3.48,
          totalDeals: dealsList.length,
          dealsPerHour: Math.round(dealsList.length / 24 * 10) / 10,
          activeBots: botsList.length,
          totalVolume,
          lastDealTime: lastDeal?.executedAt || new Date().toISOString()
        })
      } catch (error) {
        console.error('Failed to fetch stats:', error)
      }
    }

    fetchStats()
    const interval = setInterval(fetchStats, 30000)
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
      {/* ETH Price */}
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M11.944 17.97L4.58 13.62 11.943 24l7.37-10.38-7.372 4.35h.003zM12.056 0L4.69 12.223l7.365 4.354 7.365-4.35L12.056 0z"/>
          </svg>
          ETH PRICE
        </div>
        <div className="font-mono font-semibold text-lg">
          ${stats.ethPrice.toLocaleString()}
          <span className="text-chart-2 text-sm ml-2">+{stats.ethChange}%</span>
        </div>
      </div>

      {/* Total Deals */}
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          TOTAL DEALS
        </div>
        <div className="font-mono font-semibold text-lg">
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
          ACTIVE BOTS
        </div>
        <div className="font-mono font-semibold text-lg">
          {stats.activeBots} bots
        </div>
      </div>

      {/* Total Volume */}
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
          TOTAL VOLUME
        </div>
        <div className="font-mono font-semibold text-lg">
          ${stats.totalVolume.toLocaleString()} <span className="text-muted-foreground text-sm">USDC</span>
        </div>
      </div>
    </div>
  )
}
