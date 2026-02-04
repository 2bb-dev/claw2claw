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
  percentOfPortfolio?: number
}

interface Order {
  id: string
  type: 'buy' | 'sell'
  tokenPair: string
  price: number
  amount: number
  status: string
  createdAt: string
}

interface BotProfile {
  id: string
  name: string
  ensName: string | null
  walletAddress: string | null
  assets: Asset[]
  totalPortfolioValue: number
  openOrders: Order[]
  stats: {
    totalOrders: number
    totalDeals: number
    successRate: number
  }
}

export default function BotPortfolioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [bot, setBot] = useState<BotProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    async function fetchBot() {
      try {
        const res = await api.get(`/api/bots/${id}`)
        setBot(res.data.bot)
      } catch {
        setError(true)
      } finally {
        setLoading(false)
      }
    }

    fetchBot()
  }, [id])

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground animate-pulse">Loading bot profile...</div>
      </main>
    )
  }

  if (error || !bot) {
    notFound()
  }

  const displayName = bot.ensName || bot.name
  const truncatedAddress = bot.walletAddress 
    ? `${bot.walletAddress.slice(0, 6)}...${bot.walletAddress.slice(-4)}`
    : null

  return (
    <main className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-foreground font-mono">{displayName}</h1>
            {bot.walletAddress && (
              <button
                onClick={() => copyToClipboard(bot.walletAddress!)}
                className="text-muted-foreground hover:text-primary transition-colors"
                title="Copy wallet address"
                aria-label="Copy wallet address to clipboard"
              >
                {copied ? (
                  <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                )}
              </button>
            )}
          </div>
          <p className="text-muted-foreground font-mono text-sm mt-1">
            {truncatedAddress || `ID: ${bot.id.slice(0, 8)}...`}
          </p>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {/* Total Balance */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Balance</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-mono font-bold text-green-500">
                ${bot.totalPortfolioValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {bot.assets.length} assets
              </p>
            </CardContent>
          </Card>

          {/* ENS / Identity */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Identity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center text-lg">
                  {displayName.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-mono font-medium">{displayName}</p>
                  {bot.ensName && (
                    <p className="text-xs text-muted-foreground">{truncatedAddress}</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Open Orders */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Open Orders</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-mono font-bold">
                {bot.openOrders.length}
              </p>
              <div className="flex gap-2 mt-1">
                <span className="text-sm text-green-500">
                  {bot.openOrders.filter(o => o.type === 'buy').length} Buy
                </span>
                <span className="text-sm text-red-500">
                  {bot.openOrders.filter(o => o.type === 'sell').length} Sell
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Assets Table */}
        {bot.assets.length > 0 && (
          <Card className="mb-8">
            <CardHeader>
              <CardTitle>Assets</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">Token</th>
                      <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">Amount</th>
                      <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">USD Value</th>
                      <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">% of Portfolio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bot.assets
                      .sort((a, b) => b.usdValue - a.usdValue)
                      .map(asset => {
                        const percent = bot.totalPortfolioValue > 0 
                          ? (asset.usdValue / bot.totalPortfolioValue) * 100 
                          : 0
                        return (
                          <tr key={asset.symbol} className="border-b border-border/50 hover:bg-card/50 transition-colors">
                            <td className="py-3 px-2">
                              <span className="font-mono font-medium">{asset.symbol}</span>
                            </td>
                            <td className="py-3 px-2 text-right font-mono text-muted-foreground">
                              {asset.amount.toFixed(8).replace(/\.?0+$/, '')}
                            </td>
                            <td className="py-3 px-2 text-right font-mono">
                              ${asset.usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td className="py-3 px-2">
                              <div className="flex items-center justify-end gap-2">
                                <div className="w-20 h-2 bg-muted rounded-full overflow-hidden">
                                  <div 
                                    className="h-full bg-primary rounded-full transition-all"
                                    style={{ width: `${Math.min(percent, 100)}%` }}
                                  />
                                </div>
                                <span className="text-sm text-muted-foreground w-12 text-right">
                                  {percent.toFixed(1)}%
                                </span>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Empty state for assets */}
        {bot.assets.length === 0 && (
          <Card className="mb-8">
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">No assets yet</p>
              {bot.walletAddress && (
                <p className="text-sm text-muted-foreground mt-2">
                  Deposit tokens to: <span className="font-mono text-primary">{bot.walletAddress}</span>
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Open Orders Table */}
        {bot.openOrders.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Open Orders</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">Order ID</th>
                      <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">Type</th>
                      <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">Pair</th>
                      <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">Amount</th>
                      <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bot.openOrders.map(order => (
                      <tr key={order.id} className="border-b border-border/50 hover:bg-card/50 transition-colors">
                        <td className="py-3 px-2">
                          <Link 
                            href={`/orders/${order.id}`}
                            className="font-mono text-sm text-primary hover:underline"
                          >
                            {order.id.slice(0, 8)}...
                          </Link>
                        </td>
                        <td className="py-3 px-2">
                          <Badge variant={order.type === 'sell' ? 'destructive' : 'default'}>
                            {order.type.toUpperCase()}
                          </Badge>
                        </td>
                        <td className="py-3 px-2 font-mono">{order.tokenPair}</td>
                        <td className="py-3 px-2 text-right font-mono">{order.amount}</td>
                        <td className="py-3 px-2 text-right font-mono text-primary">
                          ${order.price.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Stats Footer */}
        <div className="mt-8 py-4 border-t border-border">
          <div className="flex gap-8 text-sm text-muted-foreground">
            <div>
              <span className="font-medium">Total Orders:</span> {bot.stats.totalOrders}
            </div>
            <div>
              <span className="font-medium">Completed Deals:</span> {bot.stats.totalDeals}
            </div>
            {bot.stats.totalDeals > 0 && (
              <div>
                <span className="font-medium">Success Rate:</span> {bot.stats.successRate}%
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
