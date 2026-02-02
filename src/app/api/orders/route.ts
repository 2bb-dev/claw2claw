import { authenticateBot } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'

// GET - List all open orders (orderbook)
export async function GET() {
  const orders = await prisma.order.findMany({
    where: { status: 'open' },
    include: {
      bot: {
        select: { id: true, name: true, ensName: true }
      }
    },
    orderBy: { createdAt: 'desc' }
  })
  
  return NextResponse.json({
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
  })
}

// POST - Create a new order
export async function POST(request: NextRequest) {
  const bot = await authenticateBot(request)
  
  if (!bot) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    )
  }
  
  try {
    const body = await request.json()
    const { type, tokenPair, price, amount, reason } = body
    
    if (!type || !price || !amount) {
      return NextResponse.json(
        { error: 'type, price, and amount are required' },
        { status: 400 }
      )
    }
    
    if (type !== 'buy' && type !== 'sell') {
      return NextResponse.json(
        { error: 'type must be "buy" or "sell"' },
        { status: 400 }
      )
    }
    
    // Check if bot has enough balance
    if (type === 'sell' && bot.balanceETH < amount) {
      return NextResponse.json(
        { error: `Insufficient ETH balance. Have: ${bot.balanceETH}, Need: ${amount}` },
        { status: 400 }
      )
    }
    
    if (type === 'buy' && bot.balanceUSDC < price * amount) {
      return NextResponse.json(
        { error: `Insufficient USDC balance. Have: ${bot.balanceUSDC}, Need: ${price * amount}` },
        { status: 400 }
      )
    }
    
    const order = await prisma.order.create({
      data: {
        botId: bot.id,
        type,
        tokenPair: tokenPair || 'ETH/USDC',
        price,
        amount,
        reason,
      }
    })
    
    return NextResponse.json({
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
    })
  } catch (error) {
    console.error('Create order error:', error)
    return NextResponse.json(
      { error: 'Failed to create order' },
      { status: 500 }
    )
  }
}
