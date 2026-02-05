import { FastifyInstance } from 'fastify'
import { prisma } from '../db.js'

export async function dealsRoutes(fastify: FastifyInstance) {
  // GET /api/deals - List all completed deals
  fastify.get('/', async () => {
    const deals = await prisma.deal.findMany({
      include: {
        maker: { select: { id: true, name: true, ensName: true } },
        taker: { select: { id: true, name: true, ensName: true } },
        order: { select: { type: true, tokenPair: true } }
      },
      orderBy: { executedAt: 'desc' },
      take: 100
    })
    
    return {
      success: true,
      deals: deals.map(deal => ({
        id: deal.id,
        type: deal.order.type,
        tokenPair: deal.order.tokenPair,
        price: deal.price,
        amount: deal.amount,
        total: deal.price * deal.amount,
        maker: deal.maker,
        taker: deal.taker,
        makerReview: deal.makerReview,
        takerReview: deal.takerReview,
        executedAt: deal.executedAt,
      }))
    }
  })

  // GET /api/deals/:id - Get deal details
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params
    
    const deal = await prisma.deal.findUnique({
      where: { id },
      include: {
        maker: { 
          select: { 
            id: true, 
            name: true, 
            ensName: true,
            assets: {
              select: { symbol: true, amount: true, usdPrice: true }
            }
          } 
        },
        taker: { 
          select: { 
            id: true, 
            name: true, 
            ensName: true,
            assets: {
              select: { symbol: true, amount: true, usdPrice: true }
            }
          } 
        },
        order: { select: { type: true, tokenPair: true, price: true, amount: true } }
      }
    })
    
    if (!deal) {
      return reply.status(404).send({ error: 'Deal not found' })
    }

    // Transform assets to include usdValue (amount * usdPrice)
    const transformAssets = (assets: { symbol: string; amount: number; usdPrice: number }[]) =>
      assets.map(a => ({ symbol: a.symbol, amount: a.amount, usdValue: a.amount * a.usdPrice }))
    
    return {
      success: true,
      deal: {
        id: deal.id,
        type: deal.order.type,
        tokenPair: deal.order.tokenPair,
        price: deal.price,
        amount: deal.amount,
        total: deal.price * deal.amount,
        maker: {
          id: deal.maker.id,
          name: deal.maker.name,
          ensName: deal.maker.ensName,
          assets: transformAssets(deal.maker.assets)
        },
        taker: {
          id: deal.taker.id,
          name: deal.taker.name,
          ensName: deal.taker.ensName,
          assets: transformAssets(deal.taker.assets)
        },
        makerReview: deal.makerReview,
        takerReview: deal.takerReview,
        executedAt: deal.executedAt,
      }
    }
  })
}
