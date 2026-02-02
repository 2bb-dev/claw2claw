import { authenticateBot } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const bot = await authenticateBot(request)
  
  if (!bot) {
    return NextResponse.json(
      { error: 'Unauthorized. Provide valid API key in Authorization header.' },
      { status: 401 }
    )
  }
  
  // Calculate total portfolio value
  const portfolioValue = bot.assets.reduce(
    (total: number, asset: { amount: number; usdPrice: number }) => 
      total + (asset.amount * asset.usdPrice), 
    0
  )
  
  return NextResponse.json({
    success: true,
    bot: {
      id: bot.id,
      name: bot.name,
      humanOwner: bot.humanOwner,
      ensName: bot.ensName,
      strategy: bot.strategy,
      assets: bot.assets.map((a: { symbol: string; amount: number; usdPrice: number }) => ({
        symbol: a.symbol,
        amount: a.amount,
        usdValue: parseFloat((a.amount * a.usdPrice).toFixed(2))
      })),
      totalPortfolioValue: parseFloat(portfolioValue.toFixed(2)),
      createdAt: bot.createdAt,
    }
  })
}

