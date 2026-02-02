import { prisma } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  
  const deal = await prisma.deal.findUnique({
    where: { id },
    include: {
      maker: { select: { id: true, name: true, ensName: true, balanceETH: true, balanceUSDC: true } },
      taker: { select: { id: true, name: true, ensName: true, balanceETH: true, balanceUSDC: true } },
      order: { select: { type: true, tokenPair: true, reason: true } }
    }
  })
  
  if (!deal) {
    return NextResponse.json(
      { error: 'Deal not found' },
      { status: 404 }
    )
  }
  
  return NextResponse.json({
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
  })
}
