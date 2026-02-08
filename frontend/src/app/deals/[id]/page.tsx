'use client'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { api } from '@/lib/api'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { use, useEffect, useState } from 'react'
import { formatUnits } from 'viem'

// Known token decimals (fallback to 18 for unknown tokens)
const TOKEN_DECIMALS: Record<string, number> = {
  ETH: 18, WETH: 18, USDC: 6, USDT: 6, DAI: 18,
  WBTC: 8, MATIC: 18, AVAX: 18, BNB: 18, ARB: 18, OP: 18,
}

function formatTokenAmount(amount: string, tokenSymbol: string): string {
  const decimals = TOKEN_DECIMALS[tokenSymbol.toUpperCase()] ?? 18
  try {
    const formatted = formatUnits(BigInt(amount), decimals)
    const num = parseFloat(formatted)
    if (num === 0) return '0'
    if (num >= 1000) return num.toLocaleString('en-US', { maximumFractionDigits: 2 })
    if (num >= 1) return num.toLocaleString('en-US', { maximumFractionDigits: 4 })
    return num.toPrecision(6).replace(/0+$/, '').replace(/\.$/, '')
  } catch {
    return amount
  }
}

// Chain explorer base URLs
const EXPLORER_URLS: Record<number, string> = {
  1: 'https://etherscan.io',
  8453: 'https://basescan.org',
  10: 'https://optimistic.etherscan.io',
  42161: 'https://arbiscan.io',
  137: 'https://polygonscan.com',
  56: 'https://bscscan.com',
  43114: 'https://snowscan.xyz',
}

const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  8453: 'Base',
  10: 'Optimism',
  42161: 'Arbitrum',
  137: 'Polygon',
  56: 'BSC',
  43114: 'Avalanche',
}

interface Deal {
  id: string
  txHash: string
  regime: string
  chainId: number
  fromToken: string
  toToken: string
  fromAmount: string
  toAmount: string | null
  botAddress: string
  status: string
  makerComment: string | null
  takerComment: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
}

function truncateAddress(addr: string) {
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

function regimeLabel(regime: string) {
  if (regime.startsWith('lifi')) return 'LI.FI Swap'
  return 'P2P Trade'
}

function statusColor(status: string) {
  switch (status) {
    case 'completed': return 'bg-green-500/20 text-green-400 border-green-500/30'
    case 'pending': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
    case 'failed': return 'bg-red-500/20 text-red-400 border-red-500/30'
    default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30'
  }
}

export default function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [deal, setDeal] = useState<Deal | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    async function fetchDeal() {
      try {
        const res = await api.get(`/api/deals/${id}`)
        setDeal(res.data.deal)
      } catch {
        setError(true)
      } finally {
        setLoading(false)
      }
    }

    fetchDeal()
  }, [id])

  if (loading) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </main>
    )
  }

  if (error || !deal) {
    notFound()
  }

  const explorerBase = EXPLORER_URLS[deal.chainId]
  const chainName = CHAIN_NAMES[deal.chainId] ?? `Chain ${deal.chainId}`
  const txUrl = explorerBase ? `${explorerBase}/tx/${deal.txHash}` : null
  const addressUrl = explorerBase ? `${explorerBase}/address/${deal.botAddress}` : null
  const isPending = deal.txHash.startsWith('pending-')

  return (
    <main className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center gap-4 mb-2">
            <Link href="/" className="text-muted-foreground hover:text-foreground">
              ← Back
            </Link>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Deal Details</h1>
            <p className="text-muted-foreground font-mono text-sm">{deal.id}</p>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        {/* Deal Summary */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-4 flex-wrap">
              <Badge className={`text-sm px-3 py-1 border ${statusColor(deal.status)}`}>
                {deal.status.toUpperCase()}
              </Badge>
              <Badge variant="outline" className="text-sm px-3 py-1">
                {regimeLabel(deal.regime)}
              </Badge>
              <Badge variant="secondary" className="text-sm px-3 py-1">
                {chainName}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Swap visualization */}
            <div className="flex items-center justify-center gap-6 py-6">
              <div className="text-center">
                <div className="text-sm text-muted-foreground mb-1">From</div>
                <div className="text-3xl font-mono font-bold">
                  {formatTokenAmount(deal.fromAmount, deal.fromToken)}
                </div>
                <div className="text-lg text-primary font-semibold">{deal.fromToken}</div>
              </div>
              <div className="text-2xl text-muted-foreground">→</div>
              <div className="text-center">
                <div className="text-sm text-muted-foreground mb-1">To</div>
                <div className="text-3xl font-mono font-bold">
                  {deal.toAmount ? formatTokenAmount(deal.toAmount, deal.toToken) : '...'}
                </div>
                <div className="text-lg text-primary font-semibold">{deal.toToken}</div>
              </div>
            </div>

            <div className="grid md:grid-cols-3 gap-8 pt-4 border-t border-border">
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">Created At</h3>
                <p className="text-lg">{new Date(deal.createdAt).toLocaleString()}</p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">Bot Address</h3>
                {addressUrl ? (
                  <a
                    href={addressUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-primary hover:underline"
                  >
                    {truncateAddress(deal.botAddress)}
                  </a>
                ) : (
                  <p className="font-mono">{truncateAddress(deal.botAddress)}</p>
                )}
              </div>
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">Transaction</h3>
                {isPending ? (
                  <p className="font-mono text-yellow-400">Pending...</p>
                ) : txUrl ? (
                  <a
                    href={txUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-primary hover:underline"
                  >
                    {truncateAddress(deal.txHash)}
                  </a>
                ) : (
                  <p className="font-mono">{truncateAddress(deal.txHash)}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Bot Comments */}
        {(deal.makerComment || deal.takerComment) && (
          <div className="grid md:grid-cols-2 gap-6 mb-8">
            {deal.makerComment && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <span>📤</span> Maker Reasoning
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="italic text-muted-foreground">&ldquo;{deal.makerComment}&rdquo;</p>
                </CardContent>
              </Card>
            )}
            {deal.takerComment && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <span>📥</span> Taker Reasoning
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="italic text-muted-foreground">&ldquo;{deal.takerComment}&rdquo;</p>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Metadata (if present) */}
        {deal.metadata && Object.keys(deal.metadata).length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Metadata</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="text-sm font-mono text-muted-foreground bg-muted/30 rounded-lg p-4 overflow-x-auto">
                {JSON.stringify(deal.metadata, null, 2)}
              </pre>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  )
}
