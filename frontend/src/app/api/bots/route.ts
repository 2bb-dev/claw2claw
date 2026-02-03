import { prisma } from '@/lib/db'
import { NextResponse } from 'next/server'

export async function GET() {
  const bots = await prisma.bot.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: {
      assets: true,
      _count: {
        select: {
          orders: true,
          dealsAsMaker: true,
          dealsAsTaker: true
        }
      }
    }
  })
  
  return NextResponse.json({
    success: true,
    bots: bots.map(bot => {
      const portfolioValue = bot.assets.reduce(
        (total: number, asset: { amount: number; usdPrice: number }) => 
          total + (asset.amount * asset.usdPrice), 
        0
      )
      return {
        id: bot.id,
        name: bot.name,
        ensName: bot.ensName,
        assets: bot.assets.map((a: { symbol: string; amount: number; usdPrice: number }) => ({
          symbol: a.symbol,
          amount: a.amount,
          usdValue: parseFloat((a.amount * a.usdPrice).toFixed(2))
        })),
        totalPortfolioValue: parseFloat(portfolioValue.toFixed(2)),
        createdAt: bot.createdAt,
        ordersCount: bot._count.orders,
        dealsCount: bot._count.dealsAsMaker + bot._count.dealsAsTaker
      }
    })
  })
}

