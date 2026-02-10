'use client'

import { Header } from '@/components/header'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { api } from '@/lib/api'
import { formatTokenAmount } from '@/lib/format'
import { notFound, useRouter } from 'next/navigation'
import { use, useEffect, useState } from 'react'



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
  fromTokenDecimals: number
  toTokenDecimals: number
  botAddress: string
  botEnsName: string | null
  status: string
  makerAddress: string | null
  takerAddress: string | null
  makerEnsName: string | null
  takerEnsName: string | null
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
  const router = useRouter()
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
  const fromChainName = CHAIN_NAMES[deal.chainId] ?? `Chain ${deal.chainId}`
  const toChainId = (deal.metadata?.toChain as number) || deal.chainId
  const toChainName = CHAIN_NAMES[toChainId] ?? `Chain ${toChainId}`
  const isCrossChain = deal.chainId !== toChainId
  const txUrl = explorerBase ? `${explorerBase}/tx/${deal.txHash}` : null
  const isPending = deal.txHash.startsWith('pending-')

  return (
    <main className="min-h-screen bg-background">
      <Header />

      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => router.back()} className="text-muted-foreground hover:text-foreground transition-colors text-lg">←</button>
          <h1 className="text-2xl font-bold text-foreground">Deal Details</h1>
        </div>
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
                {isCrossChain ? `${fromChainName} → ${toChainName}` : fromChainName}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Swap visualization */}
            <div className="flex items-center justify-center gap-6 py-6">
              <div className="text-center">
                <div className="text-sm text-muted-foreground mb-1">From</div>
                <div className="text-3xl font-mono font-bold">
                  {formatTokenAmount(deal.fromAmount, deal.fromTokenDecimals)}
                </div>
                <div className="text-lg text-primary font-semibold">{deal.fromToken}</div>
                <div className="text-xs text-muted-foreground mt-1">{fromChainName}</div>
              </div>
              <div className="text-2xl text-muted-foreground">→</div>
              <div className="text-center">
                <div className="text-sm text-muted-foreground mb-1">To</div>
                <div className="text-3xl font-mono font-bold">
                  {deal.toAmount ? formatTokenAmount(deal.toAmount, deal.toTokenDecimals) : '...'}
                </div>
                <div className="text-lg text-primary font-semibold">{deal.toToken}</div>
                <div className="text-xs text-muted-foreground mt-1">{toChainName}</div>
              </div>
            </div>

            {/* Metadata row */}
            <div className={`grid grid-cols-1 ${deal.regime.startsWith('p2p') ? 'md:grid-cols-2' : 'md:grid-cols-3'} gap-4 pt-4 border-t border-border`}>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Created At</div>
                <div className="text-sm font-mono">{new Date(deal.createdAt).toLocaleString()}</div>
              </div>
              {!deal.regime.startsWith('p2p') && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Bot</div>
                  {explorerBase ? (
                    <a
                      href={`${explorerBase}/address/${deal.botAddress}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-sm text-primary hover:underline"
                    >
                      {deal.botEnsName || truncateAddress(deal.botAddress)}
                    </a>
                  ) : (
                    <p className="font-mono text-sm">{deal.botEnsName || truncateAddress(deal.botAddress)}</p>
                  )}
                </div>
              )}
              <div>
                <div className="text-xs text-muted-foreground mb-1">Transaction</div>
                {!isPending && txUrl ? (
                  <a
                    href={txUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-sm text-primary hover:underline"
                  >
                    {truncateAddress(deal.txHash)}
                  </a>
                ) : (
                  <p className="font-mono text-sm">{isPending ? 'Pending...' : truncateAddress(deal.txHash)}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* P2P Addresses */}
        {deal.regime.startsWith('p2p') && (deal.makerAddress || deal.takerAddress) && (
          <Card className="mb-8">
            <CardHeader>
              <CardTitle>P2P Trade Participants</CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`grid gap-6 ${deal.makerAddress && deal.takerAddress ? 'md:grid-cols-2' : 'grid-cols-1'}`}>
                {deal.makerAddress && (
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Maker</div>
                    {explorerBase ? (
                      <a
                        href={`${explorerBase}/address/${deal.makerAddress}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-sm text-primary hover:underline"
                      >
                        {deal.makerEnsName || truncateAddress(deal.makerAddress)}
                      </a>
                    ) : (
                      <p className="font-mono text-sm">{deal.makerEnsName || truncateAddress(deal.makerAddress)}</p>
                    )}
                  </div>
                )}
                {deal.takerAddress && (
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Taker</div>
                    {explorerBase ? (
                      <a
                        href={`${explorerBase}/address/${deal.takerAddress}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-sm text-primary hover:underline"
                      >
                        {deal.takerEnsName || truncateAddress(deal.takerAddress)}
                      </a>
                    ) : (
                      <p className="font-mono text-sm">{deal.takerEnsName || truncateAddress(deal.takerAddress)}</p>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Bot Comments */}
        {(deal.makerComment || deal.takerComment) && (
          <div className={`grid gap-6 mb-8 ${deal.makerComment && deal.takerComment ? 'md:grid-cols-2' : 'grid-cols-1'}`}>
            {deal.makerComment && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    Maker Reasoning
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
                    Taker Reasoning
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="italic text-muted-foreground">&ldquo;{deal.takerComment}&rdquo;</p>
                </CardContent>
              </Card>
            )}
          </div>
        )}


      </div>
    </main>
  )
}
