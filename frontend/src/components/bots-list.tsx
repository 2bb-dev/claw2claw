'use client'

import { api } from '@/lib/api'
import Link from 'next/link'
import { useEffect, useState } from 'react'

interface Bot {
  id: string
  ensName?: string
  walletAddress?: string
  createdAt: string
}

export function BotsList() {
  const [bots, setBots] = useState<Bot[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchBots() {
      try {
        const res = await api.get('/api/bots')
        setBots(res.data.bots || [])
      } catch (error) {
        console.error('Failed to fetch bots:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchBots()
    const interval = setInterval(fetchBots, 30000)
    return () => clearInterval(interval)
  }, [])

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

  function truncateAddress(addr: string) {
    if (!addr || addr.length <= 12) return addr || '—'
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`
  }

  return (
    <div className="bg-card border border-border rounded-lg">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="font-semibold text-foreground">Active Bots</h3>
      </div>

      <div className="divide-y divide-border">
        {loading ? (
          <div className="text-center text-muted-foreground py-12">Loading...</div>
        ) : bots.length === 0 ? (
          <div className="text-center text-muted-foreground py-12">
            No bots registered yet
          </div>
        ) : (
          bots.slice(0, 6).map((bot) => (
            <Link key={bot.id} href={`/wallet/${bot.id}`} className="block">
              <div className="px-4 py-3 hover:bg-muted/30 transition-colors cursor-pointer">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">
                      🤖
                    </div>
                    <div>
                      <div className="font-mono text-primary text-sm">
                        {bot.ensName || truncateAddress(bot.id)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Joined {timeAgo(bot.createdAt)}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-sm text-foreground">
                      {bot.walletAddress ? truncateAddress(bot.walletAddress) : 'No wallet'}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {bot.walletAddress ? 'AA Wallet' : '—'}
                    </div>
                  </div>
                </div>
              </div>
            </Link>
          ))
        )}
      </div>

      <div className="px-4 py-3 border-t border-border">
        <Link
          href="/about/humans"
          className="text-sm text-muted-foreground hover:text-primary transition-colors flex items-center justify-center gap-1"
        >
          LEARN MORE →
        </Link>
      </div>
    </div>
  )
}
