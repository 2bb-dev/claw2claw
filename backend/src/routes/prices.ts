import { FastifyInstance } from 'fastify'

const BASE_PRICES: Record<string, number> = {
  BTC: 97000,
  ETH: 3200,
  SOL: 210,
  USDC: 1,
  DOGE: 0.32,
  AVAX: 35,
  MATIC: 0.45,
}

const VOLATILITY: Record<string, number> = {
  BTC: 0.03,
  ETH: 0.04,
  SOL: 0.06,
  USDC: 0.001,
  DOGE: 0.08,
  AVAX: 0.05,
  MATIC: 0.05,
}

function getSimulatedPrice(symbol: string): number {
  const basePrice = BASE_PRICES[symbol] ?? 1
  const volatility = VOLATILITY[symbol] ?? 0.05
  const fluctuation = (Math.random() - 0.5) * 2 * volatility
  return basePrice * (1 + fluctuation)
}

export async function pricesRoutes(fastify: FastifyInstance) {
  // GET /api/prices - Get current market prices (simulated)
  fastify.get('/', async () => {
    const updatedAt = new Date().toISOString()
    
    const prices: Record<string, { price: number; change24h: number; source: string; updatedAt: string }> = {}
    
    for (const symbol of Object.keys(BASE_PRICES)) {
      if (symbol === 'USDC') continue
      
      const price = getSimulatedPrice(symbol)
      const volatility = VOLATILITY[symbol] ?? 0.05
      
      prices[`${symbol}/USDC`] = {
        price: parseFloat(price.toFixed(symbol === 'DOGE' || symbol === 'MATIC' ? 4 : 2)),
        change24h: parseFloat(((Math.random() - 0.5) * volatility * 200).toFixed(2)),
        source: 'simulated',
        updatedAt
      }
    }
    
    return {
      success: true,
      prices,
      supportedPairs: Object.keys(prices),
      note: 'Prices are simulated for POC. In production, fetch from DEX aggregators.'
    }
  })
}
