'use client'

import { Header } from '@/components/header'
import { api } from '@/lib/api'
import { formatTokenAmount } from '@/lib/format'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'

interface OnChainOrder {
  orderId: number
  maker: string
  sellToken: string
  buyToken: string
  amountIn: string
  minAmountOut: string
  expiry: string
  active: boolean
  isExpired: boolean
  sellTokenDecimals?: number
  buyTokenDecimals?: number
  dealLogId?: string | null
}

function truncateAddress(addr: string) {
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

function timeUntil(dateString: string) {
  const seconds = Math.floor((new Date(dateString).getTime() - Date.now()) / 1000)
  if (seconds <= 0) return 'Expired'
  if (seconds < 60) return `${seconds}s left`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m left`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h left`
  const days = Math.floor(hours / 24)
  return `${days}d left`
}

export default function AllOrdersPage() {
  return (
    <Suspense>
      <AllOrdersContent />
    </Suspense>
  )
}

function AllOrdersContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const botAddress = searchParams.get('botAddress')

  const [orders, setOrders] = useState<OnChainOrder[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchOrders() {
      try {
        const res = await api.get('/api/orders')
        setOrders(res.data.orders || [])
      } catch (error) {
        console.error('Failed to fetch orders:', error)
      } finally {
        setLoading(false)
      }
    }

    setLoading(true)
    fetchOrders()
    const interval = setInterval(fetchOrders, 15000)
    return () => clearInterval(interval)
  }, [botAddress])

  const activeOrders = orders.filter(o => {
    if (!o.active || o.isExpired) return false
    if (botAddress) return o.maker.toLowerCase() === botAddress.toLowerCase()
    return true
  })

  const heading = botAddress ? `Orders for ${truncateAddress(botAddress)}` : 'All Orders'

  return (
    <main className="min-h-screen bg-background">
      <Header />

      {/* Page header */}
      <div className="container mx-auto px-4 py-8">
        <button
          onClick={() => router.back()}
          className="text-sm text-muted-foreground hover:text-primary transition-colors mb-4 flex items-center gap-1"
        >
          ← Back
        </button>
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">{heading}</h1>
          <p className="text-sm text-muted-foreground">{activeOrders.length} active orders</p>
        </div>

        {/* Orders list */}
        <div className="bg-card border border-border rounded-lg">
          <div className="divide-y divide-border">
            {loading ? (
              <div className="text-center text-muted-foreground py-16">Loading...</div>
            ) : activeOrders.length === 0 ? (
              <div className="text-center text-muted-foreground py-16">No active orders</div>
            ) : (
              activeOrders.map((order) => {
                const href = order.dealLogId
                  ? `/orders/${order.dealLogId}`
                  : `/orders/${order.orderId}`

                return (
                  <Link
                    key={order.orderId}
                    href={href}
                    className="block px-4 py-3 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      {/* Direction icon */}
                      <div className="w-8 h-8 rounded flex-shrink-0 flex items-center justify-center text-xs font-bold bg-blue-500/20 text-blue-400">
                        ⇄
                      </div>

                      {/* Pair + maker */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-foreground text-sm">
                            {order.sellToken} → {order.buyToken}
                          </span>
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-blue-500/20 text-blue-400 border-blue-500/30">
                            P2P
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {truncateAddress(order.maker)} · {timeUntil(order.expiry)}
                        </div>
                      </div>

                      {/* Amount */}
                      <div className="text-right flex-shrink-0">
                        <div className="font-mono text-sm">
                          {formatTokenAmount(order.amountIn, order.sellTokenDecimals ?? 18)} {order.sellToken}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          min {formatTokenAmount(order.minAmountOut, order.buyTokenDecimals ?? 18)} {order.buyToken}
                        </div>
                      </div>
                    </div>
                  </Link>
                )
              })
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
