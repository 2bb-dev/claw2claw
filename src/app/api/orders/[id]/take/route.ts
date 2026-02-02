import { authenticateBot } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

// Parse token pair into base and quote assets
function parseTokenPair(tokenPair: string): { base: string; quote: string } {
  const [base, quote] = tokenPair.split('/')
  return { base: base.toUpperCase(), quote: quote.toUpperCase() }
}

// Get bot's balance for a specific asset
async function getBotAssetBalance(botId: string, symbol: string): Promise<number> {
  const asset = await prisma.botAsset.findUnique({
    where: { botId_symbol: { botId, symbol: symbol.toUpperCase() } }
  })
  return asset?.amount ?? 0
}

// POST - Take an order (execute a deal)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const taker = await authenticateBot(request)
  
  if (!taker) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    )
  }
  
  const { id } = await params
  
  try {
    const body = await request.json()
    const { review } = body
    
    const order = await prisma.order.findUnique({
      where: { id },
      include: { bot: true }
    })
    
    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }
    
    if (order.status !== 'open') {
      return NextResponse.json(
        { error: 'Order is not open' },
        { status: 400 }
      )
    }
    
    if (order.botId === taker.id) {
      return NextResponse.json(
        { error: 'Cannot take your own order' },
        { status: 400 }
      )
    }
    
    const maker = order.bot
    const amount = order.amount
    const price = order.price
    const total = amount * price
    const { base, quote } = parseTokenPair(order.tokenPair)
    
    // Validate taker has enough balance
    if (order.type === 'sell') {
      // Maker is selling base asset, taker is buying → taker needs quote asset
      const takerQuoteBalance = await getBotAssetBalance(taker.id, quote)
      if (takerQuoteBalance < total) {
        return NextResponse.json(
          { error: `Insufficient ${quote}. Have: ${takerQuoteBalance}, Need: ${total}` },
          { status: 400 }
        )
      }
    } else {
      // Maker is buying base asset, taker is selling → taker needs base asset
      const takerBaseBalance = await getBotAssetBalance(taker.id, base)
      if (takerBaseBalance < amount) {
        return NextResponse.json(
          { error: `Insufficient ${base}. Have: ${takerBaseBalance}, Need: ${amount}` },
          { status: 400 }
        )
      }
    }
    
    // Execute the deal in a transaction
    const deal = await prisma.$transaction(async (tx) => {
      // Update order status
      await tx.order.update({
        where: { id },
        data: { status: 'filled' }
      })
      
      if (order.type === 'sell') {
        // Maker sells base → Maker: -base +quote, Taker: +base -quote
        await tx.botAsset.update({
          where: { botId_symbol: { botId: maker.id, symbol: base } },
          data: { amount: { decrement: amount } }
        })
        await tx.botAsset.upsert({
          where: { botId_symbol: { botId: maker.id, symbol: quote } },
          update: { amount: { increment: total } },
          create: { botId: maker.id, symbol: quote, amount: total, usdPrice: 1 }
        })
        await tx.botAsset.upsert({
          where: { botId_symbol: { botId: taker.id, symbol: base } },
          update: { amount: { increment: amount } },
          create: { botId: taker.id, symbol: base, amount, usdPrice: price }
        })
        await tx.botAsset.update({
          where: { botId_symbol: { botId: taker.id, symbol: quote } },
          data: { amount: { decrement: total } }
        })
      } else {
        // Maker buys base → Maker: +base -quote, Taker: -base +quote
        await tx.botAsset.upsert({
          where: { botId_symbol: { botId: maker.id, symbol: base } },
          update: { amount: { increment: amount } },
          create: { botId: maker.id, symbol: base, amount, usdPrice: price }
        })
        await tx.botAsset.update({
          where: { botId_symbol: { botId: maker.id, symbol: quote } },
          data: { amount: { decrement: total } }
        })
        await tx.botAsset.update({
          where: { botId_symbol: { botId: taker.id, symbol: base } },
          data: { amount: { decrement: amount } }
        })
        await tx.botAsset.upsert({
          where: { botId_symbol: { botId: taker.id, symbol: quote } },
          update: { amount: { increment: total } },
          create: { botId: taker.id, symbol: quote, amount: total, usdPrice: 1 }
        })
      }
      
      // Create deal record
      return tx.deal.create({
        data: {
          orderId: order.id,
          makerId: maker.id,
          takerId: taker.id,
          price,
          amount,
          makerReview: order.reason,
          takerReview: review,
        },
        include: {
          maker: { select: { id: true, name: true } },
          taker: { select: { id: true, name: true } }
        }
      })
    })
    
    return NextResponse.json({
      success: true,
      deal: {
        id: deal.id,
        type: order.type,
        tokenPair: order.tokenPair,
        price: deal.price,
        amount: deal.amount,
        maker: deal.maker,
        taker: deal.taker,
        makerReview: deal.makerReview,
        takerReview: deal.takerReview,
        executedAt: deal.executedAt,
      }
    })
  } catch (error) {
    console.error('Take order error:', error)
    return NextResponse.json(
      { error: 'Failed to execute deal' },
      { status: 500 }
    )
  }
}
