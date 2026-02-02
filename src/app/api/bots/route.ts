import { prisma } from '@/lib/db'
import { NextResponse } from 'next/server'

export async function GET() {
  const bots = await prisma.bot.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      name: true,
      ensName: true,
      balanceETH: true,
      balanceUSDC: true,
      createdAt: true,
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
    bots: bots.map(bot => ({
      id: bot.id,
      name: bot.name,
      ensName: bot.ensName,
      balanceETH: bot.balanceETH,
      balanceUSDC: bot.balanceUSDC,
      createdAt: bot.createdAt,
      ordersCount: bot._count.orders,
      dealsCount: bot._count.dealsAsMaker + bot._count.dealsAsTaker
    }))
  })
}
