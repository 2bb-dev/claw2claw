'use client'

import { api } from '@/lib/api'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { formatUnits } from 'viem'

// Known token decimals (fallback to 18 for unknown tokens)
const TOKEN_DECIMALS: Record<string, number> = {
  ETH: 18,
  WETH: 18,
  USDC: 6,
  USDT: 6,
  DAI: 18,
  WBTC: 8,
  MATIC: 18,
  AVAX: 18,
  BNB: 18,
  ARB: 18,
  OP: 18,
}

function formatTokenAmount(amount: string, tokenSymbol: string): string {
  const decimals = TOKEN_DECIMALS[tokenSymbol.toUpperCase()] ?? 18
  try {
    const formatted = formatUnits(BigInt(amount), decimals)
    // Trim trailing zeros but keep at least 2 decimal places for stablecoins
    const num = parseFloat(formatted)
    if (num === 0) return '0'
    if (num >= 1000) return num.toLocaleString('en-US', { maximumFractionDigits: 2 })
    if (num >= 1) return num.toLocaleString('en-US', { maximumFractionDigits: 4 })
    // Small amounts — show up to 6 significant digits
    return num.toPrecision(6).replace(/0+$/, '').replace(/\.$/, '')
  } catch {
    return amount
  }
}

type ViewMode = 'all' | 'p2p'

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

interface DealsListProps {
  viewMode: ViewMode
  botAddress?: string | null
  botLabel?: string | null
}

export function DealsList({ viewMode, botAddress, botLabel }: DealsListProps) {
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

  const filteredDeals = viewMode === 'p2p'
    ? deals.filter((d) => d.regime === 'p2p')
    : deals

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
    if (addr.length <= 12) return addr
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`
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

  const headerText = botLabel
    ? `Trades for ${botLabel.includes('.') ? botLabel : truncateAddress(botLabel)}`
    : 'Latest Trades'

  return (
    <div className="bg-card border border-border rounded-lg">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="font-semibold text-foreground">{headerText}</h3>
        <span className="text-xs text-muted-foreground">
          {filteredDeals.length} {viewMode === 'p2p' ? 'P2P' : 'total'} trades
        </span>
      </div>

      {/* List */}
      <div className="divide-y divide-border">
        {loading ? (
          <div className="text-center text-muted-foreground py-12">Loading...</div>
        ) : filteredDeals.length === 0 ? (
          <div className="text-center text-muted-foreground py-12">
            No {viewMode === 'p2p' ? 'P2P ' : ''}trades yet
          </div>
        ) : (
          filteredDeals.slice(0, 10).map((deal) => (
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
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-primary text-sm">
                        {deal.txHash && !deal.txHash.startsWith('pending-')
                          ? truncateAddress(deal.txHash)
                          : `#${deal.id.slice(0, 8)}`}
                      </span>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${regimeStyle(deal.regime)}`}>
                        {regimeLabel(deal.regime)}
                      </span>
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
                    {formatTokenAmount(deal.fromAmount, deal.fromToken)} {deal.fromToken}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    → {deal.toAmount ? formatTokenAmount(deal.toAmount, deal.toToken) : '...'} {deal.toToken}
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
          VIEW ALL TRADES →
        </Link>
      </div>
    </div>
  )
}
