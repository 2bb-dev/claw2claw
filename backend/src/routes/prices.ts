import { FastifyInstance } from 'fastify'
import { fetchPricesForTokens, getPricesForTokenPairs, getTokenPrice } from '../services/prices.js'

export async function pricesRoutes(fastify: FastifyInstance) {
  // POST /api/prices/tokens - Get prices for specific tokens (batch)
  fastify.post<{ Body: { tokens: string[] } }>('/tokens', async (request, reply) => {
    const { tokens } = request.body
    
    if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
      return reply.status(400).send({ error: 'tokens array is required' })
    }
    
    if (tokens.length > 50) {
      return reply.status(400).send({ error: 'Maximum 50 tokens per request' })
    }
    
    try {
      const prices = await fetchPricesForTokens(tokens)
      
      return {
        success: true,
        prices: Object.fromEntries(
          Object.entries(prices).map(([symbol, data]) => [
            symbol,
            {
              price: data.price,
              change24h: data.change24h,
              updatedAt: data.updatedAt.toISOString(),
            }
          ])
        ),
        source: 'coingecko',
      }
    } catch (error) {
      console.error('Batch price fetch error:', error)
      return reply.status(500).send({ error: 'Failed to fetch prices' })
    }
  })

  // POST /api/prices/pairs - Get prices for specific trading pairs
  fastify.post<{ Body: { pairs: string[] } }>('/pairs', async (request, reply) => {
    const { pairs } = request.body
    
    if (!pairs || !Array.isArray(pairs) || pairs.length === 0) {
      return reply.status(400).send({ error: 'pairs array is required' })
    }
    
    if (pairs.length > 50) {
      return reply.status(400).send({ error: 'Maximum 50 pairs per request' })
    }
    
    try {
      const prices = await getPricesForTokenPairs(pairs)
      
      return {
        success: true,
        prices,
        source: 'coingecko',
      }
    } catch (error) {
      console.error('Pair price fetch error:', error)
      return reply.status(500).send({ error: 'Failed to fetch prices' })
    }
  })

  // GET /api/prices/:symbol - Get price for a specific token
  fastify.get<{ Params: { symbol: string } }>('/:symbol', async (request, reply) => {
    const { symbol } = request.params
    
    try {
      const price = await getTokenPrice(symbol)
      
      if (!price) {
        return reply.status(404).send({
          success: false,
          error: `Price not found for ${symbol}. Check if the token symbol is correct.`,
        })
      }
      
      return {
        success: true,
        symbol: symbol.toUpperCase(),
        price: price.price,
        change24h: price.change24h,
        updatedAt: price.updatedAt.toISOString(),
        source: 'coingecko',
      }
    } catch (error) {
      console.error(`Price fetch error for ${symbol}:`, error)
      return reply.status(500).send({
        success: false,
        error: 'Failed to fetch price',
      })
    }
  })
}
