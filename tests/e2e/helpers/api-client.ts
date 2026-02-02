export interface BotInfo {
  id: string
  name: string
  apiKey: string
  assets: { symbol: string; amount: number; usdValue: number }[]
  totalPortfolioValue: number
}

export interface Order {
  id: string
  bot: { id: string; name: string; ensName?: string }
  type: 'buy' | 'sell'
  tokenPair: string
  price: number
  amount: number
  reason?: string
  status?: string
  createdAt: string
}

export interface Deal {
  id: string
  type: string
  tokenPair: string
  price: number
  amount: number
  maker: { id: string; name: string }
  taker: { id: string; name: string }
  makerReview?: string
  takerReview?: string
  executedAt: string
}

export interface Prices {
  [pair: string]: {
    price: number
    change24h: number
    source: string
    updatedAt: string
  }
}

export class BotClient {
  constructor(
    private baseUrl: string,
    public apiKey: string,
    public botInfo?: BotInfo
  ) {}

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    }
    
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers,
    })

    const data = await response.json()
    
    if (!response.ok) {
      throw new Error(data.error || `Request failed: ${response.status}`)
    }
    
    return data
  }

  async getMe(): Promise<BotInfo> {
    const data = await this.request<{ bot: BotInfo }>('/api/bots/me')
    return data.bot
  }

  async createOrder(
    type: 'buy' | 'sell',
    tokenPair: string,
    price: number,
    amount: number,
    reason?: string
  ): Promise<Order> {
    const data = await this.request<{ order: Order }>('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ type, tokenPair, price, amount, reason }),
    })
    return data.order
  }

  async listOrders(): Promise<Order[]> {
    const data = await this.request<{ orders: Order[] }>('/api/orders')
    return data.orders
  }

  async takeOrder(orderId: string, review?: string): Promise<Deal> {
    const data = await this.request<{ deal: Deal }>(
      `/api/orders/${orderId}/take`,
      {
        method: 'POST',
        body: JSON.stringify({ review }),
      }
    )
    return data.deal
  }

  async cancelOrder(orderId: string): Promise<void> {
    await this.request(`/api/orders/${orderId}`, {
      method: 'DELETE',
    })
  }

  async getPrices(): Promise<Prices> {
    const data = await this.request<{ prices: Prices }>('/api/prices')
    return data.prices
  }

  async listDeals(): Promise<Deal[]> {
    const data = await this.request<{ deals: Deal[] }>('/api/deals')
    return data.deals
  }

  getAssetBalance(symbol: string): number {
    const asset = this.botInfo?.assets.find(a => a.symbol === symbol)
    return asset?.amount ?? 0
  }
}

export async function registerBot(
  baseUrl: string,
  name: string,
  humanOwner: string = 'e2e-test'
): Promise<BotClient> {
  const response = await fetch(`${baseUrl}/api/bots/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, humanOwner }),
  })

  const data = await response.json()
  
  if (!response.ok) {
    throw new Error(data.error || 'Registration failed')
  }

  const client = new BotClient(baseUrl, data.bot.apiKey, data.bot)
  return client
}
