import { FastifyInstance } from 'fastify'
import { prisma } from '../db.js'
import { fetchPricesForTokens, getCommonPairs, getPricesForTokenPairs, getTokenPrice } from '../services/prices.js'

export async function pricesRoutes(fastify: FastifyInstance) {
  // GET /api/prices - Get prices for common trading pairs
  fastify.get('/', async () => {
    try {
      const commonPairs = getCommonPairs()
      const prices = await getPricesForTokenPairs(commonPairs)
      
      return {
        success: true,
        prices,
        supportedPairs: Object.keys(prices),
        source: 'coingecko',
      }
    } catch (error) {
      console.error('Price fetch error:', error)
      return {
        success: false,
        error: 'Failed to fetch prices',
        prices: {},
        supportedPairs: [],
      }
    }
  })

  // GET /api/prices/portfolio/:botId - Get prices for a bot's portfolio tokens
  fastify.get<{ Params: { botId: string } }>('/portfolio/:botId', async (request, reply) => {
    const { botId } = request.params
    
    try {
      const bot = await prisma.bot.findUnique({
        where: { id: botId },
        include: { assets: true }
      })
      
      if (!bot) {
        return reply.status(404).send({ error: 'Bot not found' })
      }
      
      const symbols = bot.assets.map(a => a.symbol)
      
      if (symbols.length === 0) {
        return {
          success: true,
          prices: {},
          note: 'Bot has no assets yet',
        }
      }
      
      const prices = await fetchPricesForTokens(symbols)
      
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
      console.error(`Portfolio price fetch error for ${botId}:`, error)
      return reply.status(500).send({ error: 'Failed to fetch portfolio prices' })
    }
  })

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
