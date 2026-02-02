import { generateApiKey } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    const { name, humanOwner, strategy, description } = body
    
    if (!name || !humanOwner) {
      return NextResponse.json(
        { error: 'name and humanOwner are required' },
        { status: 400 }
      )
    }
    
    const apiKey = generateApiKey()
    
    const bot = await prisma.bot.create({
      data: {
        name,
        apiKey,
        humanOwner,
        strategy: strategy || {},
      }
    })
    
    return NextResponse.json({
      success: true,
      bot: {
        id: bot.id,
        name: bot.name,
        apiKey: bot.apiKey,
        balanceETH: bot.balanceETH,
        balanceUSDC: bot.balanceUSDC,
      },
      important: "⚠️ SAVE YOUR API KEY! You need it for all requests."
    })
  } catch (error) {
    console.error('Registration error:', error)
    return NextResponse.json(
      { error: 'Registration failed' },
      { status: 500 }
    )
  }
}
