import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '../db.js'
import { authenticateBot } from '../auth.js'

function parseTokenPair(tokenPair: string): { base: string; quote: string } {
  const [base, quote] = tokenPair.split('/')
  return { base: base.toUpperCase(), quote: quote.toUpperCase() }
}

async function getBotAssetBalance(botId: string, symbol: string): Promise<number> {
  const asset = await prisma.botAsset.findUnique({
    where: { botId_symbol: { botId, symbol: symbol.toUpperCase() } }
  })
  return asset?.amount ?? 0
}

interface CreateOrderBody {
  type: 'buy' | 'sell'
  tokenPair?: string
  price: number
  amount: number
  reason?: string
}

export async function ordersRoutes(fastify: FastifyInstance) {
  // GET /api/orders - List all open orders
  fastify.get('/', async () => {
    const orders = await prisma.order.findMany({
      where: { status: 'open' },
      include: {
        bot: {
          select: { id: true, name: true, ensName: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    })
    
    return {
      success: true,
      orders: orders.map(order => ({
        id: order.id,
        bot: order.bot,
        type: order.type,
        tokenPair: order.tokenPair,
        price: order.price,
        amount: order.amount,
        reason: order.reason,
        createdAt: order.createdAt,
      }))
    }
  })

  // POST /api/orders - Create a new order
  fastify.post<{ Body: CreateOrderBody }>('/', async (request, reply) => {
    const bot = await authenticateBot(request as FastifyRequest)
    
    if (!bot) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }
    
    try {
      const { type, tokenPair = 'ETH/USDC', price, amount, reason } = request.body
      
      if (!type || !price || !amount) {
        return reply.status(400).send({
          error: 'type, price, and amount are required'
        })
      }
      
      if (type !== 'buy' && type !== 'sell') {
        return reply.status(400).send({
          error: 'type must be "buy" or "sell"'
        })
      }

      const { base, quote } = parseTokenPair(tokenPair)
      
      if (type === 'sell') {
        const baseBalance = await getBotAssetBalance(bot.id, base)
        if (baseBalance < amount) {
          return reply.status(400).send({
            error: `Insufficient ${base} balance. Have: ${baseBalance}, Need: ${amount}`
          })
        }
      } else {
        const quoteBalance = await getBotAssetBalance(bot.id, quote)
        const totalCost = price * amount
        if (quoteBalance < totalCost) {
          return reply.status(400).send({
            error: `Insufficient ${quote} balance. Have: ${quoteBalance}, Need: ${totalCost}`
          })
        }
      }
      
      const order = await prisma.order.create({
        data: {
          botId: bot.id,
          type,
          tokenPair,
          price,
          amount,
          reason,
        }
      })
      
      return {
        success: true,
        order: {
          id: order.id,
          type: order.type,
          tokenPair: order.tokenPair,
          price: order.price,
          amount: order.amount,
          status: order.status,
          createdAt: order.createdAt,
        }
      }
    } catch (error) {
      console.error('Create order error:', error)
      return reply.status(500).send({ error: 'Failed to create order' })
    }
  })

  // DELETE /api/orders/:id - Cancel an order
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const bot = await authenticateBot(request as FastifyRequest)
    
    if (!bot) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }
    
    try {
      const { id } = request.params
      
      const order = await prisma.order.findUnique({
        where: { id }
      })
      
      if (!order) {
        return reply.status(404).send({ error: 'Order not found' })
      }
      
      if (order.botId !== bot.id) {
        return reply.status(403).send({ error: 'Not your order' })
      }
      
      if (order.status !== 'open') {
        return reply.status(400).send({ error: 'Order is not open' })
      }
      
      await prisma.order.update({
        where: { id },
        data: { status: 'cancelled' }
      })
      
      return { success: true, message: 'Order cancelled' }
    } catch (error) {
      console.error('Cancel order error:', error)
      return reply.status(500).send({ error: 'Failed to cancel order' })
    }
  })
}
