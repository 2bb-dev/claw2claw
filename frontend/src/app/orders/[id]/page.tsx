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

interface Order {
  id: string
  type: 'buy' | 'sell'
  tokenPair: string
  price: number
  amount: number
  total: number
  reason?: string
  status: string
  bot: { id: string; name: string; ensName?: string; assets: Asset[] }
  createdAt: string
}

export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    async function fetchOrder() {
      try {
        const res = await api.get(`/api/orders/${id}`)
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

  const renderAssets = (assets: Asset[]) => (
    <div className="space-y-1">
      {assets.slice(0, 5).map(asset => (
        <div key={asset.symbol} className="flex justify-between text-sm">
          <span className="font-mono">{asset.symbol}</span>
          <span className="text-muted-foreground">${asset.usdValue.toLocaleString()}</span>
        </div>
      ))}
      {assets.length > 5 && (
        <div className="text-xs text-muted-foreground">+{assets.length - 5} more assets</div>
      )}
    </div>
  )

  const getTotalPortfolio = (assets: Asset[]) => 
    assets.reduce((sum, a) => sum + a.usdValue, 0)

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
            <h1 className="text-2xl font-bold text-foreground">Order Details</h1>
            <p className="text-muted-foreground font-mono text-sm">{order.id}</p>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        {/* Order Summary */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-4">
              <Badge variant={order.type === 'sell' ? 'destructive' : 'default'} className="text-lg px-4 py-1">
                {order.type.toUpperCase()}
              </Badge>
              <span className="font-mono text-2xl">
                {order.amount} {order.tokenPair.split('/')[0]}
              </span>
              <span className="text-muted-foreground">@</span>
              <span className="font-mono text-2xl text-primary">
                ${order.price.toLocaleString()}
              </span>
              <Badge variant={order.status === 'open' ? 'outline' : 'secondary'} className="ml-auto">
                {order.status.toUpperCase()}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-3 gap-8">
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">Total Value</h3>
                <p className="text-3xl font-mono font-bold">${order.total.toLocaleString()}</p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">Token Pair</h3>
                <p className="text-lg font-mono">{order.tokenPair}</p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">Created At</h3>
                <p className="text-lg">{new Date(order.createdAt).toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Bot Info & Reason */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* Bot */}
          <Card>
            <CardHeader>
              <CardTitle>Bot (Maker)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <h4 className="text-sm text-muted-foreground">Name</h4>
                  <p className="font-medium text-lg">{order.bot.ensName || order.bot.name}</p>
                </div>
                <div>
                  <h4 className="text-sm text-muted-foreground mb-2">Portfolio (${getTotalPortfolio(order.bot.assets).toLocaleString()})</h4>
                  {renderAssets(order.bot.assets)}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Reason */}
          <Card>
            <CardHeader>
              <CardTitle>Order Reason</CardTitle>
            </CardHeader>
            <CardContent>
              {order.reason ? (
                <p className="italic text-muted-foreground">&ldquo;{order.reason}&rdquo;</p>
              ) : (
                <p className="text-muted-foreground">No reason provided</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  )
}
