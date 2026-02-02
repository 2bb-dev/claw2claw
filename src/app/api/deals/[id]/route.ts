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
      maker: { 
        select: { id: true, name: true, ensName: true },
      },
      taker: { 
        select: { id: true, name: true, ensName: true },
      },
      order: { select: { type: true, tokenPair: true, reason: true } }
    }
  })
  
  if (!deal) {
    return NextResponse.json(
      { error: 'Deal not found' },
      { status: 404 }
    )
  }

  // Get assets for maker and taker
  const [makerAssets, takerAssets] = await Promise.all([
    prisma.botAsset.findMany({ where: { botId: deal.maker.id } }),
    prisma.botAsset.findMany({ where: { botId: deal.taker.id } })
  ])
  
  return NextResponse.json({
    success: true,
    deal: {
      id: deal.id,
      type: deal.order.type,
      tokenPair: deal.order.tokenPair,
      price: deal.price,
      amount: deal.amount,
      total: deal.price * deal.amount,
      maker: {
        ...deal.maker,
        assets: makerAssets.map((a: { symbol: string; amount: number; usdPrice: number }) => ({
          symbol: a.symbol,
          amount: a.amount,
          usdValue: parseFloat((a.amount * a.usdPrice).toFixed(2))
        }))
      },
      taker: {
        ...deal.taker,
        assets: takerAssets.map((a: { symbol: string; amount: number; usdPrice: number }) => ({
          symbol: a.symbol,
          amount: a.amount,
          usdValue: parseFloat((a.amount * a.usdPrice).toFixed(2))
        }))
      },
      makerReview: deal.makerReview,
      takerReview: deal.takerReview,
      executedAt: deal.executedAt,
    }
  })
}

