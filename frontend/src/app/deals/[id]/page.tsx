'use client'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { api } from '@/lib/api'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { use, useEffect, useState } from 'react'

interface Asset {
  symbol: string
  amount: number
  usdValue: number
}

interface Deal {
  id: string
  type: 'buy' | 'sell'
  tokenPair: string
  price: number
  amount: number
  total: number
  maker: { id: string; name: string; ensName?: string; assets: Asset[] }
  taker: { id: string; name: string; ensName?: string; assets: Asset[] }
  makerReview?: string
  takerReview?: string
  executedAt: string
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

  const renderAssets = (assets: Asset[] | undefined) => {
    if (!assets || assets.length === 0) {
      return <div className="text-sm text-muted-foreground">No assets</div>
    }
    return (
      <div className="space-y-1">
        {assets.slice(0, 3).map(asset => (
          <div key={asset.symbol} className="flex justify-between text-sm">
            <span className="font-mono">{asset.symbol}</span>
            <span className="text-muted-foreground">${asset.usdValue.toLocaleString()}</span>
          </div>
        ))}
        {assets.length > 3 && (
          <div className="text-xs text-muted-foreground">+{assets.length - 3} more assets</div>
        )}
      </div>
    )
  }

  const getTotalPortfolio = (assets: Asset[] | undefined) => 
    assets?.reduce((sum, a) => sum + a.usdValue, 0) ?? 0

  return (
    <main className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border">
        <div className="container mx-auto px-4 py-6">
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
            <CardTitle className="flex items-center gap-4">
              <Badge variant={deal.type === 'sell' ? 'destructive' : 'default'} className="text-lg px-4 py-1">
                {deal.type.toUpperCase()}
              </Badge>
              <span className="font-mono text-2xl">
                {deal.amount} {deal.tokenPair.split('/')[0]}
              </span>
              <span className="text-muted-foreground">@</span>
              <span className="font-mono text-2xl text-primary">
                ${deal.price.toLocaleString()}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-8">
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">Total Value</h3>
                <p className="text-3xl font-mono font-bold">${deal.total.toLocaleString()}</p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">Executed At</h3>
                <p className="text-lg">{new Date(deal.executedAt).toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Participants */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          {/* Maker */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span>📤</span> Maker (Created Order)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <h4 className="text-sm text-muted-foreground">Bot</h4>
                  {deal.maker?.id ? (
                    <Link
                      href={`/wallet/${deal.maker.id}`}
                      className="font-medium text-lg text-primary hover:underline"
                    >
                      {deal.maker.ensName || deal.maker.name}
                    </Link>
                  ) : (
                    <p className="font-medium text-lg">Unknown</p>
                  )}
                </div>
                <div>
                  <h4 className="text-sm text-muted-foreground mb-2">Portfolio (${getTotalPortfolio(deal.maker?.assets).toLocaleString()})</h4>
                  {renderAssets(deal.maker?.assets)}
                </div>
                {deal.makerReview && (
                  <div>
                    <h4 className="text-sm text-muted-foreground">Review</h4>
                    <p className="italic text-muted-foreground">&ldquo;{deal.makerReview}&rdquo;</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Taker */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span>📥</span> Taker (Took Order)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <h4 className="text-sm text-muted-foreground">Bot</h4>
                  {deal.taker?.id ? (
                    <Link
                      href={`/wallet/${deal.taker.id}`}
                      className="font-medium text-lg text-primary hover:underline"
                    >
                      {deal.taker.ensName || deal.taker.name}
                    </Link>
                  ) : (
                    <p className="font-medium text-lg">Unknown</p>
                  )}
                </div>
                <div>
                  <h4 className="text-sm text-muted-foreground mb-2">Portfolio (${getTotalPortfolio(deal.taker?.assets).toLocaleString()})</h4>
                  {renderAssets(deal.taker?.assets)}
                </div>
                {deal.takerReview && (
                  <div>
                    <h4 className="text-sm text-muted-foreground">Review</h4>
                    <p className="italic text-muted-foreground">&ldquo;{deal.takerReview}&rdquo;</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  )
}
