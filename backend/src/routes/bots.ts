import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '../db.js'
import { authenticateBot, generateApiKey } from '../auth.js'

// Reference prices for crypto assets
const CRYPTO_ASSETS = [
  { symbol: 'BTC', usdPrice: 97000 },
  { symbol: 'ETH', usdPrice: 3200 },
  { symbol: 'SOL', usdPrice: 210 },
  { symbol: 'USDC', usdPrice: 1 },
  { symbol: 'DOGE', usdPrice: 0.32 },
  { symbol: 'AVAX', usdPrice: 35 },
  { symbol: 'MATIC', usdPrice: 0.45 },
]

const TOTAL_PORTFOLIO_VALUE = 1000

function generateRandomAssetPack() {
  const weights = CRYPTO_ASSETS.map(() => Math.random())
  const totalWeight = weights.reduce((a, b) => a + b, 0)
  const normalizedWeights = weights.map(w => w / totalWeight)
  
  return CRYPTO_ASSETS.map((asset, i) => {
    const usdAllocation = TOTAL_PORTFOLIO_VALUE * normalizedWeights[i]
    const amount = usdAllocation / asset.usdPrice
    return {
      symbol: asset.symbol,
      amount: parseFloat(amount.toFixed(8)),
      usdPrice: asset.usdPrice,
    }
  })
}

interface RegisterBody {
  name: string
  humanOwner: string
  strategy?: Record<string, unknown>
}

export async function botsRoutes(fastify: FastifyInstance) {
  // GET /api/bots - List all bots
  fastify.get('/', async () => {
    const bots = await prisma.bot.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        assets: true,
        _count: {
          select: {
            orders: true,
            dealsAsMaker: true,
            dealsAsTaker: true
          }
        }
      }
    })
    
    return {
      success: true,
      bots: bots.map(bot => {
        const portfolioValue = bot.assets.reduce(
          (total, asset) => total + (asset.amount * asset.usdPrice), 
          0
        )
        return {
          id: bot.id,
          name: bot.name,
          ensName: bot.ensName,
          assets: bot.assets.map(a => ({
            symbol: a.symbol,
            amount: a.amount,
            usdValue: parseFloat((a.amount * a.usdPrice).toFixed(2))
          })),
          totalPortfolioValue: parseFloat(portfolioValue.toFixed(2)),
          createdAt: bot.createdAt,
          ordersCount: bot._count.orders,
          dealsCount: bot._count.dealsAsMaker + bot._count.dealsAsTaker
        }
      })
    }
  })

  // GET /api/bots/me - Get authenticated bot's profile
  fastify.get('/me', async (request: FastifyRequest, reply: FastifyReply) => {
    const bot = await authenticateBot(request)
    
    if (!bot) {
      return reply.status(401).send({
        error: 'Unauthorized. Provide valid API key in Authorization header.'
      })
    }
    
    const portfolioValue = bot.assets.reduce(
      (total, asset) => total + (asset.amount * asset.usdPrice), 
      0
    )
    
    return {
      success: true,
      bot: {
        id: bot.id,
        name: bot.name,
        humanOwner: bot.humanOwner,
        ensName: bot.ensName,
        strategy: bot.strategy,
        assets: bot.assets.map(a => ({
          symbol: a.symbol,
          amount: a.amount,
          usdValue: parseFloat((a.amount * a.usdPrice).toFixed(2))
        })),
        totalPortfolioValue: parseFloat(portfolioValue.toFixed(2)),
        createdAt: bot.createdAt,
      }
    }
  })

  // POST /api/bots/register - Register a new bot
  fastify.post<{ Body: RegisterBody }>('/register', async (request, reply) => {
    try {
      const { name, humanOwner, strategy } = request.body
      
      if (!name || !humanOwner) {
        return reply.status(400).send({
          error: 'name and humanOwner are required'
        })
      }
      
      const apiKey = generateApiKey()
      const assetPack = generateRandomAssetPack()
      
      const bot = await prisma.bot.create({
        data: {
          name,
          apiKey,
          humanOwner,
          strategy: strategy || {},
          assets: {
            create: assetPack.map(asset => ({
              symbol: asset.symbol,
              amount: asset.amount,
              usdPrice: asset.usdPrice,
            }))
          }
        },
        include: {
          assets: true
        }
      })
      
      const portfolioValue = bot.assets.reduce(
        (total, asset) => total + (asset.amount * asset.usdPrice), 
        0
      )
      
      return {
        success: true,
        bot: {
          id: bot.id,
          name: bot.name,
          apiKey: bot.apiKey,
          assets: bot.assets.map(a => ({
            symbol: a.symbol,
            amount: a.amount,
            usdValue: parseFloat((a.amount * a.usdPrice).toFixed(2))
          })),
          totalPortfolioValue: parseFloat(portfolioValue.toFixed(2)),
        },
        important: "⚠️ SAVE YOUR API KEY! You need it for all requests."
      }
    } catch (error) {
      console.error('Registration error:', error)
      return reply.status(500).send({ error: 'Registration failed' })
    }
  })
}
