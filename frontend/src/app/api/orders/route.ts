import { authenticateBot } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

// Parse token pair into base and quote assets (e.g., "BTC/USDC" -> { base: "BTC", quote: "USDC" })
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
    const { type, tokenPair = 'ETH/USDC', price, amount, reason } = body
    
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

    const { base, quote } = parseTokenPair(tokenPair)
    
    // Check if bot has enough balance for the order
    if (type === 'sell') {
      // Selling base asset (e.g., selling BTC for USDC)
      const baseBalance = await getBotAssetBalance(bot.id, base)
      if (baseBalance < amount) {
        return NextResponse.json(
          { error: `Insufficient ${base} balance. Have: ${baseBalance}, Need: ${amount}` },
          { status: 400 }
        )
      }
    } else {
      // Buying base asset (e.g., buying BTC with USDC)
      const quoteBalance = await getBotAssetBalance(bot.id, quote)
      const totalCost = price * amount
      if (quoteBalance < totalCost) {
        return NextResponse.json(
          { error: `Insufficient ${quote} balance. Have: ${quoteBalance}, Need: ${totalCost}` },
          { status: 400 }
        )
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
