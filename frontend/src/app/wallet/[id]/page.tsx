'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { api } from '@/lib/api'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { use, useEffect, useState } from 'react'

interface WalletData {
  bot: {
    id: string
    ensName: string | null
    createdAt: string
  }
  wallet: {
    address: string
    balance: string
    balanceFormatted: string
  }
}

export default function BotWalletPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [data, setData] = useState<WalletData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    async function fetchWallet() {
      try {
        const res = await api.get(`/api/bots/${id}/wallet`)
        setData(res.data)
      } catch (err: unknown) {
        const axiosErr = err as { response?: { status?: number } }
        if (axiosErr.response?.status === 404) {
          setError('Bot not found or no wallet configured')
        } else {
          setError('Failed to load wallet data')
        }
      } finally {
        setLoading(false)
      }
    }

    fetchWallet()
  }, [id])

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground animate-pulse">Loading wallet...</div>
      </main>
    )
  }

  if (error || !data) {
    if (error === 'Bot not found or no wallet configured') notFound()
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-destructive">{error || 'Something went wrong'}</div>
      </main>
    )
  }

  const { bot, wallet } = data
  const displayName = bot.ensName || `Bot ${bot.id.slice(0, 8)}`
  const truncatedAddress = `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`

  return (
    <main className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center gap-4 mb-2">
            <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors">
              ← Back
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-foreground font-mono">{displayName}</h1>
            <button
              onClick={() => copyToClipboard(wallet.address)}
              className="text-muted-foreground hover:text-primary transition-colors"
              title="Copy wallet address"
              aria-label="Copy wallet address"
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
          </div>
          <p className="text-muted-foreground font-mono text-sm mt-1">{truncatedAddress}</p>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        {/* Info Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {/* Identity */}
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
                  <p className="text-xs text-muted-foreground">{truncatedAddress}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Balance (on-chain) */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Balance (on-chain)</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-mono font-bold text-foreground">{wallet.balanceFormatted}</p>
              <p className="text-xs text-muted-foreground mt-1">Native balance</p>
            </CardContent>
          </Card>

          {/* Registered */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Registered</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-lg font-medium">{new Date(bot.createdAt).toLocaleDateString()}</p>
              <p className="text-xs text-muted-foreground">{new Date(bot.createdAt).toLocaleTimeString()}</p>
            </CardContent>
          </Card>
        </div>

        {/* Wallet Address */}
        <Card>
          <CardHeader>
            <CardTitle>Wallet</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div>
                <p className="text-sm text-muted-foreground mb-1">AA Smart Wallet (EIP-4337)</p>
                <p className="font-mono text-primary text-sm break-all">{wallet.address}</p>
              </div>
              <div className="text-sm text-muted-foreground">
                Deposit tokens to this address to start trading.
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
