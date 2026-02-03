import { FastifyInstance, FastifyRequest } from 'fastify';
import { authenticateBot } from '../auth.js';
import { prisma } from '../db.js';

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

  // POST /api/orders/:id/take - Take an order (execute trade)
  fastify.post<{ Params: { id: string }; Body: { review?: string } }>(
    '/:id/take',
    async (request, reply) => {
      const taker = await authenticateBot(request as FastifyRequest)

      if (!taker) {
        return reply.status(401).send({ error: 'Unauthorized' })
      }

      try {
        const { id } = request.params
        const { review } = request.body || {}

        const order = await prisma.order.findUnique({
          where: { id },
          include: { bot: true }
        })

        if (!order) {
          return reply.status(404).send({ error: 'Order not found' })
        }

        if (order.status !== 'open') {
          return reply.status(400).send({ error: 'Order is no longer open' })
        }

        if (order.botId === taker.id) {
          return reply.status(400).send({ error: 'Cannot take your own order' })
        }

        const { base, quote } = parseTokenPair(order.tokenPair)
        const totalValue = order.price * order.amount

        // Check taker has sufficient balance
        if (order.type === 'sell') {
          // Maker is selling base, taker needs quote to buy
          const takerQuoteBalance = await getBotAssetBalance(taker.id, quote)
          if (takerQuoteBalance < totalValue) {
            return reply.status(400).send({
              error: `Insufficient ${quote} balance. Have: ${takerQuoteBalance}, Need: ${totalValue}`
            })
          }
        } else {
          // Maker is buying base, taker needs base to sell
          const takerBaseBalance = await getBotAssetBalance(taker.id, base)
          if (takerBaseBalance < order.amount) {
            return reply.status(400).send({
              error: `Insufficient ${base} balance. Have: ${takerBaseBalance}, Need: ${order.amount}`
            })
          }
        }

        // Execute atomic swap in a transaction
        const deal = await prisma.$transaction(async (tx) => {
          // Update order status
          await tx.order.update({
            where: { id },
            data: { status: 'filled' }
          })

          if (order.type === 'sell') {
            // Maker sells base → taker gets base, maker gets quote
            // Deduct base from maker
            await tx.botAsset.update({
              where: { botId_symbol: { botId: order.botId, symbol: base } },
              data: { amount: { decrement: order.amount } }
            })
            // Add base to taker
            await tx.botAsset.upsert({
              where: { botId_symbol: { botId: taker.id, symbol: base } },
              update: { amount: { increment: order.amount } },
              create: { botId: taker.id, symbol: base, amount: order.amount, usdPrice: 0 }
            })
            // Deduct quote from taker
            await tx.botAsset.update({
              where: { botId_symbol: { botId: taker.id, symbol: quote } },
              data: { amount: { decrement: totalValue } }
            })
            // Add quote to maker
            await tx.botAsset.upsert({
              where: { botId_symbol: { botId: order.botId, symbol: quote } },
              update: { amount: { increment: totalValue } },
              create: { botId: order.botId, symbol: quote, amount: totalValue, usdPrice: 0 }
            })
          } else {
            // Maker buys base → taker gives base, maker gives quote
            // Deduct quote from maker
            await tx.botAsset.update({
              where: { botId_symbol: { botId: order.botId, symbol: quote } },
              data: { amount: { decrement: totalValue } }
            })
            // Add quote to taker
            await tx.botAsset.upsert({
              where: { botId_symbol: { botId: taker.id, symbol: quote } },
              update: { amount: { increment: totalValue } },
              create: { botId: taker.id, symbol: quote, amount: totalValue, usdPrice: 0 }
            })
            // Deduct base from taker
            await tx.botAsset.update({
              where: { botId_symbol: { botId: taker.id, symbol: base } },
              data: { amount: { decrement: order.amount } }
            })
            // Add base to maker
            await tx.botAsset.upsert({
              where: { botId_symbol: { botId: order.botId, symbol: base } },
              update: { amount: { increment: order.amount } },
              create: { botId: order.botId, symbol: base, amount: order.amount, usdPrice: 0 }
            })
          }

          // Create deal record
          return tx.deal.create({
            data: {
              orderId: order.id,
              makerId: order.botId,
              takerId: taker.id,
              price: order.price,
              amount: order.amount,
              makerReview: order.reason,
              takerReview: review,
            },
            include: {
              maker: { select: { id: true, name: true, ensName: true } },
              taker: { select: { id: true, name: true, ensName: true } },
              order: { select: { type: true, tokenPair: true } }
            }
          })
        })

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
      } catch (error) {
        console.error('Take order error:', error)
        return reply.status(500).send({ error: 'Failed to execute trade' })
      }
    }
  )
}
