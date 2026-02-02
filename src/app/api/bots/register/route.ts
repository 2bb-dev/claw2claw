import { generateApiKey } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'

// Reference prices for crypto assets (approximate USD values for testing)
const CRYPTO_ASSETS = [
  { symbol: 'BTC', usdPrice: 97000 },
  { symbol: 'ETH', usdPrice: 3200 },
  { symbol: 'SOL', usdPrice: 210 },
  { symbol: 'USDC', usdPrice: 1 },
  { symbol: 'DOGE', usdPrice: 0.32 },
  { symbol: 'AVAX', usdPrice: 35 },
  { symbol: 'MATIC', usdPrice: 0.45 },
]

const TOTAL_PORTFOLIO_VALUE = 1000 // $1000 total

function generateRandomAssetPack() {
  // Generate random weights for each asset
  const weights = CRYPTO_ASSETS.map(() => Math.random())
  const totalWeight = weights.reduce((a, b) => a + b, 0)
  
  // Normalize weights and calculate USD allocation per asset
  const normalizedWeights = weights.map(w => w / totalWeight)
  
  return CRYPTO_ASSETS.map((asset, i) => {
    const usdAllocation = TOTAL_PORTFOLIO_VALUE * normalizedWeights[i]
    const amount = usdAllocation / asset.usdPrice
    
    return {
      symbol: asset.symbol,
      amount: parseFloat(amount.toFixed(8)), // 8 decimal precision for crypto
      usdPrice: asset.usdPrice,
    }
  })
}

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
    const assetPack = generateRandomAssetPack()
    
    const bot = await prisma.bot.create({
      data: {
        name,
        apiKey,
        humanOwner,
        strategy: strategy || {},
        assets: {
          create: assetPack.map(asset => ({
            symbol: asset.symbol,
            amount: asset.amount,
            usdPrice: asset.usdPrice,
          }))
        }
      },
      include: {
        assets: true
      }
    })
    
    // Calculate total portfolio value for response
    const portfolioValue = bot.assets.reduce(
      (total: number, asset: { amount: number; usdPrice: number }) => total + (asset.amount * asset.usdPrice), 
      0
    )
    
    return NextResponse.json({
      success: true,
      bot: {
        id: bot.id,
        name: bot.name,
        apiKey: bot.apiKey,
        assets: bot.assets.map((a: { symbol: string; amount: number; usdPrice: number }) => ({
          symbol: a.symbol,
          amount: a.amount,
          usdValue: parseFloat((a.amount * a.usdPrice).toFixed(2))
        })),
        totalPortfolioValue: parseFloat(portfolioValue.toFixed(2)),
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
