'use client'

import { api } from '@/lib/api'
import Link from 'next/link'
import { useEffect, useState } from 'react'

interface Order {
  id: string
  bot: { id: string; name: string; ensName?: string }
  type: 'buy' | 'sell'
  tokenPair: string
  price: number
  amount: number
  reason?: string
  createdAt: string
}

export function OrdersList() {
  const [orders, setOrders] = useState<Order[]>([])
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

    fetchOrders()
    const interval = setInterval(fetchOrders, 10000)
    return () => clearInterval(interval)
  }, [])

  function timeAgo(dateString: string) {
    const seconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000)
    if (seconds < 60) return `${seconds} secs ago`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes} min ago`
    const hours = Math.floor(minutes / 60)
    return `${hours}h ago`
  }

  function truncateId(id: string) {
    if (id.length <= 12) return id
    return `${id.slice(0, 8)}...${id.slice(-4)}`
  }

  return (
    <div className="bg-card border border-border rounded-lg">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="font-semibold text-foreground">Latest Orders</h3>
      </div>

      {/* List */}
      <div className="divide-y divide-border">
        {loading ? (
          <div className="text-center text-muted-foreground py-12">Loading...</div>
        ) : orders.length === 0 ? (
          <div className="text-center text-muted-foreground py-12">
            No open orders yet
          </div>
        ) : (
          orders.slice(0, 6).map((order) => (
            <Link key={order.id} href={`/orders/${order.id}`} className="block">
              <div className="px-4 py-3 hover:bg-muted/30 transition-colors cursor-pointer">
                <div className="flex items-center justify-between">
                  {/* Left: Order ID & Time */}
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded flex items-center justify-center text-xs font-bold ${order.type === 'sell' ? 'bg-red-500/20 text-red-500' : 'bg-green-500/20 text-green-500'}`}>
                      {order.type === 'sell' ? 'S' : 'B'}
                    </div>
                    <div>
                      <div className="font-mono text-primary text-sm">
                        {truncateId(order.id)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {timeAgo(order.createdAt)}
                      </div>
                    </div>
                  </div>

                  {/* Middle: Bot */}
                  <div className="hidden md:block w-40 text-left">
                    <div className="text-sm">
                      Bot{' '}
                      <Link
                        href={`/wallet/${order.bot.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-primary hover:underline"
                      >
                        {order.bot.ensName || order.bot.name}
                      </Link>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {order.type.toUpperCase()} {order.amount} {order.tokenPair.split('/')[0]}
                    </div>
                  </div>

                  {/* Right: Price */}
                  <div className="text-right">
                    <div className="font-mono text-sm">
                      ${order.price.toLocaleString()}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {order.tokenPair}
                    </div>
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
          href="/orders"
          className="text-sm text-muted-foreground hover:text-primary transition-colors flex items-center justify-center gap-1"
        >
          VIEW ALL ORDERS →
        </Link>
      </div>
    </div>
  )
}
