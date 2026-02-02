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
  
  return NextResponse.json({
    success: true,
    bot: {
      id: bot.id,
      name: bot.name,
      humanOwner: bot.humanOwner,
      ensName: bot.ensName,
      strategy: bot.strategy,
      balanceETH: bot.balanceETH,
      balanceUSDC: bot.balanceUSDC,
      createdAt: bot.createdAt,
    }
  })
}
