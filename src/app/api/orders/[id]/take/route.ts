import { authenticateBot } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'

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
    
    // Validate taker has enough balance
    if (order.type === 'sell') {
      // Maker is selling ETH, taker is buying → taker needs USDC
      if (taker.balanceUSDC < total) {
        return NextResponse.json(
          { error: `Insufficient USDC. Have: ${taker.balanceUSDC}, Need: ${total}` },
          { status: 400 }
        )
      }
    } else {
      // Maker is buying ETH, taker is selling → taker needs ETH
      if (taker.balanceETH < amount) {
        return NextResponse.json(
          { error: `Insufficient ETH. Have: ${taker.balanceETH}, Need: ${amount}` },
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
        // Maker sells ETH → Maker gets USDC, Taker gets ETH
        await tx.bot.update({
          where: { id: maker.id },
          data: {
            balanceETH: { decrement: amount },
            balanceUSDC: { increment: total }
          }
        })
        await tx.bot.update({
          where: { id: taker.id },
          data: {
            balanceETH: { increment: amount },
            balanceUSDC: { decrement: total }
          }
        })
      } else {
        // Maker buys ETH → Maker gets ETH, Taker gets USDC
        await tx.bot.update({
          where: { id: maker.id },
          data: {
            balanceETH: { increment: amount },
            balanceUSDC: { decrement: total }
          }
        })
        await tx.bot.update({
          where: { id: taker.id },
          data: {
            balanceETH: { decrement: amount },
            balanceUSDC: { increment: total }
          }
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
