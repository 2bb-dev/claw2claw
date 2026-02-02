import { NextResponse } from 'next/server'

// GET - Get current market prices (simulated for POC)
export async function GET() {
  // Simulated prices - in production, fetch from Uniswap
  const ethPrice = 2000 + (Math.random() - 0.5) * 100 // $1950-$2050
  
  return NextResponse.json({
    success: true,
    prices: {
      'ETH/USDC': {
        price: Math.round(ethPrice * 100) / 100,
        change24h: (Math.random() - 0.5) * 10,
        source: 'simulated',
        updatedAt: new Date().toISOString()
      }
    }
  })
}
