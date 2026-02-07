import { FastifyInstance } from 'fastify'
import { prisma } from '../db.js'

export async function dealsRoutes(fastify: FastifyInstance) {
  // GET /api/deals - List all deal logs
  fastify.get('/', async () => {
    const deals = await prisma.dealLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100
    })
    
    return {
      success: true,
      deals: deals.map(deal => ({
        id: deal.id,
        txHash: deal.txHash,
        regime: deal.regime,
        chainId: deal.chainId,
        fromToken: deal.fromToken,
        toToken: deal.toToken,
        fromAmount: deal.fromAmount,
        toAmount: deal.toAmount,
        botAddress: deal.botAddress,
        status: deal.status,
        makerComment: deal.makerComment,
        takerComment: deal.takerComment,
        createdAt: deal.createdAt,
      }))
    }
  })

  // GET /api/deals/:id - Get deal details
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params
    
    const deal = await prisma.dealLog.findUnique({
      where: { id },
    })
    
    if (!deal) {
      return reply.status(404).send({ error: 'Deal not found' })
    }
    
    return {
      success: true,
      deal: {
        id: deal.id,
        txHash: deal.txHash,
        regime: deal.regime,
        chainId: deal.chainId,
        fromToken: deal.fromToken,
        toToken: deal.toToken,
        fromAmount: deal.fromAmount,
        toAmount: deal.toAmount,
        botAddress: deal.botAddress,
        status: deal.status,
        makerComment: deal.makerComment,
        takerComment: deal.takerComment,
        metadata: deal.metadata,
        createdAt: deal.createdAt,
      }
    }
  })
}
