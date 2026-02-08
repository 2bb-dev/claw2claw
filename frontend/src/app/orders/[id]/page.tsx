'use client'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { api } from '@/lib/api'
import { formatTokenAmount } from '@/lib/format'
import { notFound } from 'next/navigation'
import { use, useEffect, useState } from 'react'

const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  8453: 'Base',
  10: 'Optimism',
  42161: 'Arbitrum',
  137: 'Polygon',
  56: 'BSC',
  43114: 'Avalanche',
}

const EXPLORER_URLS: Record<number, string> = {
  1: 'https://etherscan.io',
  8453: 'https://basescan.org',
  10: 'https://optimistic.etherscan.io',
  42161: 'https://arbiscan.io',
  137: 'https://polygonscan.com',
  56: 'https://bscscan.com',
  43114: 'https://snowscan.xyz',
}

interface Order {
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
  orderId: number | null
  minBuyAmount: string | null
  duration: number | null
  botAddress: string
  botEnsName: string | null
  status: string
  makerComment: string | null
  takerComment: string | null
  createdAt: string
}

function truncateAddress(addr: string) {
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

function statusColor(status: string) {
  switch (status) {
    case 'completed': return 'bg-green-500/20 text-green-400 border-green-500/30'
    case 'pending': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
    case 'failed': return 'bg-red-500/20 text-red-400 border-red-500/30'
    default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30'
  }
}

function formatDuration(seconds: number | null) {
  if (!seconds) return 'Unknown'
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    async function fetchOrder() {
      try {
        const res = await api.get(`/api/orders/detail/${id}`)
        setOrder(res.data.order)
      } catch {
        setError(true)
      } finally {
        setLoading(false)
      }
    }

    fetchOrder()
  }, [id])

  if (loading) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </main>
    )
  }

  if (error || !order) {
    notFound()
  }

  const chainName = CHAIN_NAMES[order.chainId] ?? `Chain ${order.chainId}`
  const explorerBase = EXPLORER_URLS[order.chainId]
  const txUrl = explorerBase ? `${explorerBase}/tx/${order.txHash}` : null
  const addressUrl = explorerBase ? `${explorerBase}/address/${order.botAddress}` : null
  const isPending = order.txHash.startsWith('pending-')

  return (
    <main className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border">
        <div className="container mx-auto px-4 py-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Order Details
              {order.orderId != null && (
                <span className="text-muted-foreground ml-2 text-lg font-mono">#{order.orderId}</span>
              )}
            </h1>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        {/* Order Summary */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-4 flex-wrap">
              <Badge className={`text-sm px-3 py-1 border ${statusColor(order.status)}`}>
                {order.status.toUpperCase()}
              </Badge>
              <Badge variant="outline" className="text-sm px-3 py-1 bg-blue-500/20 text-blue-400 border-blue-500/30">
                P2P Order
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
                <div className="text-sm text-muted-foreground mb-1">Selling</div>
                <div className="text-3xl font-mono font-bold">
                  {formatTokenAmount(order.fromAmount, order.fromTokenDecimals)}
                </div>
                <div className="text-lg text-primary font-semibold">{order.fromToken}</div>
                <div className="text-xs text-muted-foreground mt-1">{chainName}</div>
              </div>
              <div className="text-2xl text-muted-foreground">→</div>
              <div className="text-center">
                <div className="text-sm text-muted-foreground mb-1">Min Buy</div>
                <div className="text-3xl font-mono font-bold">
                  {order.toAmount
                    ? formatTokenAmount(order.toAmount, order.toTokenDecimals)
                    : '...'}
                </div>
                <div className="text-lg text-primary font-semibold">{order.toToken}</div>
                <div className="text-xs text-muted-foreground mt-1">{chainName}</div>
              </div>
            </div>

            {/* Metadata row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-border">
              <div>
                <div className="text-xs text-muted-foreground mb-1">Created At</div>
                <div className="text-sm font-mono">{new Date(order.createdAt).toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Bot Address</div>
                {addressUrl ? (
                  <a
                    href={addressUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-sm text-primary hover:underline"
                  >
                    {order.botEnsName || truncateAddress(order.botAddress)}
                  </a>
                ) : (
                  <p className="font-mono text-sm">{order.botEnsName || truncateAddress(order.botAddress)}</p>
                )}
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Transaction</div>
                {!isPending && txUrl ? (
                  <a
                    href={txUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-sm text-primary hover:underline"
                  >
                    {truncateAddress(order.txHash)}
                  </a>
                ) : (
                  <p className="font-mono text-sm">{isPending ? 'Pending...' : truncateAddress(order.txHash)}</p>
                )}
              </div>
            </div>

            {/* Duration */}
            {order.duration && (
              <div className="pt-4 border-t border-border mt-4">
                <div className="text-xs text-muted-foreground mb-1">Duration</div>
                <div className="text-sm font-mono">{formatDuration(order.duration)}</div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Maker Comment */}
        {order.makerComment && (
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Maker Reasoning
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="italic text-muted-foreground">&ldquo;{order.makerComment}&rdquo;</p>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  )
}
