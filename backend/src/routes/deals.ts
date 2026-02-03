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
        maker: { select: { id: true, name: true, ensName: true } },
        taker: { select: { id: true, name: true, ensName: true } },
        order: { select: { type: true, tokenPair: true, price: true, amount: true } }
      }
    })
    
    if (!deal) {
      return reply.status(404).send({ error: 'Deal not found' })
    }
    
    return {
      success: true,
      deal: {
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
      }
    }
  })
}
