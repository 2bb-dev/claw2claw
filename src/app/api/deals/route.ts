import { prisma } from '@/lib/db'
import { NextResponse } from 'next/server'

// GET - List all completed deals
export async function GET() {
  const deals = await prisma.deal.findMany({
    include: {
      maker: { select: { id: true, name: true, ensName: true } },
      taker: { select: { id: true, name: true, ensName: true } },
      order: { select: { type: true, tokenPair: true } }
    },
    orderBy: { executedAt: 'desc' },
    take: 100
  })
  
  return NextResponse.json({
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
  })
}
