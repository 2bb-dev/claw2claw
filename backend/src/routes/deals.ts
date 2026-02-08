import { getToken, type ChainId as LiFiChainId } from '@lifi/sdk'
import { FastifyInstance } from 'fastify'
import { formatUnits } from 'viem'
import { prisma } from '../db.js'
import { cached } from '../services/cache.js'
import { getSwapStatus } from '../services/lifi.js'

/**
 * Check LI.FI status for a pending deal and update the DB if terminal.
 * Returns the resolved status string.
 */
async function resolvePendingStatus(deal: {
  id: string
  txHash: string
  status: string
  metadata: unknown
}): Promise<string> {
  // Only resolve pending deals with real txHashes
  if (deal.status !== 'pending' || deal.txHash.startsWith('pending-')) {
    return deal.status
  }

  try {
    const meta = (deal.metadata as Record<string, unknown>) ?? {}
    const fromChain = (meta.fromChain as number) || 0
    const toChain = (meta.toChain as number) || fromChain

    if (!fromChain) return deal.status

    const result = await getSwapStatus(deal.txHash, fromChain, toChain)

    if (result.status === 'DONE') {
      await prisma.dealLog.update({
        where: { id: deal.id },
        data: { status: 'completed' },
      })
      return 'completed'
    } else if (result.status === 'FAILED') {
      await prisma.dealLog.update({
        where: { id: deal.id },
        data: { status: 'failed' },
      })
      return 'failed'
    }
  } catch (error) {
    console.error(`[resolvePendingStatus] Error checking deal ${deal.id}:`, error)
  }

  return deal.status
}

// Known token decimals (fallback to 18)
const TOKEN_DECIMALS: Record<string, number> = {
  ETH: 18, WETH: 18, USDC: 6, USDT: 6, DAI: 18,
  WBTC: 8, MATIC: 18, AVAX: 18, BNB: 18, ARB: 18, OP: 18,
}

function parseTokenAmount(raw: string | null, symbol: string): number {
  if (!raw || raw === '0') return 0
  const decimals = TOKEN_DECIMALS[symbol.toUpperCase()] ?? 18
  try {
    return parseFloat(formatUnits(BigInt(raw), decimals))
  } catch {
    return parseFloat(raw) || 0
  }
}

export async function dealsRoutes(fastify: FastifyInstance) {
  // GET /api/deals - List all deal logs (optionally filtered by botAddress)
  fastify.get<{ Querystring: { botAddress?: string } }>('/', async (request) => {
    const { botAddress } = request.query
    const deals = await prisma.dealLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      ...(botAddress && { where: { botAddress } }),
    })

    // Resolve pending deals' statuses in parallel
    const pendingDeals = deals.filter(d => d.status === 'pending' && !d.txHash.startsWith('pending-'))
    const resolvedStatuses = await Promise.all(
      pendingDeals.map(d => resolvePendingStatus(d))
    )
    const statusMap = new Map(pendingDeals.map((d, i) => [d.id, resolvedStatuses[i]]))
    
    return {
      success: true,
      deals: deals.map(deal => ({
        id: deal.id,
        txHash: deal.txHash,
        regime: deal.regime,
        chainId: deal.chainId,
        fromToken: deal.fromToken,
        toToken: deal.toToken,
        fromAmount: deal.fromAmount,
        toAmount: deal.toAmount,
        botAddress: deal.botAddress,
        status: statusMap.get(deal.id) ?? deal.status,
        makerComment: deal.makerComment,
        takerComment: deal.takerComment,
        createdAt: deal.createdAt,
      }))
    }
  })

  // GET /api/deals/stats - Bot stats with PNL (powered by LI.FI priceUSD)
  fastify.get<{ Querystring: { botAddress?: string } }>('/stats', async (request) => {
    const { botAddress } = request.query
    const deals = await prisma.dealLog.findMany({
      orderBy: { createdAt: 'desc' },
      ...(botAddress && { where: { botAddress } }),
    })

    const totalTrades = deals.length
    const lifiSwaps = deals.filter(d => d.regime?.startsWith('lifi')).length
    const p2pTrades = deals.filter(d => d.regime === 'p2p').length

    // Trades per hour (based on time since first deal)
    let tradesPerHour = 0
    if (deals.length > 0) {
      const oldest = deals[deals.length - 1].createdAt
      const hoursElapsed = Math.max(1, (Date.now() - new Date(oldest).getTime()) / 3600000)
      tradesPerHour = Math.round((totalTrades / hoursElapsed) * 10) / 10
    }

    // Total volume (approximate — raw amounts converted to real values)
    const totalVolume = deals.reduce((acc, d) => acc + parseTokenAmount(d.fromAmount, d.fromToken), 0)

    // PNL calculation using LI.FI priceUSD
    let totalPnl: number | null = null
    if (botAddress && deals.length > 0) {
      try {
        // Collect unique tokens we need prices for
        const tokenSymbols = new Set<string>()
        for (const deal of deals) {
          if (deal.fromToken) tokenSymbols.add(deal.fromToken)
          if (deal.toToken) tokenSymbols.add(deal.toToken)
        }

        // Fetch prices from LI.FI (cached 2 min)
        const prices: Record<string, number> = {}
        for (const symbol of tokenSymbols) {
          try {
            const price = await cached(
              `lifi:price:${symbol}`,
              120,
              async () => {
                // Use chain 1 (mainnet) for canonical prices, fallback gracefully
                const chainId = deals[0].chainId || 1
                const token = await getToken(chainId as LiFiChainId, symbol)
                return parseFloat(token.priceUSD || '0')
              }
            )
            prices[symbol] = price
          } catch {
            // Token not found on LI.FI — try stablecoin shortcut
            const upper = symbol.toUpperCase()
            if (['USDC', 'USDT', 'DAI'].includes(upper)) {
              prices[symbol] = 1
            }
          }
        }

        // PNL = (value of tokens received) - (value of tokens spent)
        let pnl = 0
        for (const deal of deals) {
          if (deal.status !== 'completed' && deal.status !== 'pending') continue

          const fromPrice = prices[deal.fromToken] ?? 0
          const toPrice = prices[deal.toToken] ?? 0
          const fromVal = parseTokenAmount(deal.fromAmount, deal.fromToken) * fromPrice
          const toVal = parseTokenAmount(deal.toAmount, deal.toToken) * toPrice
          pnl += toVal - fromVal
        }
        totalPnl = Math.round(pnl * 100) / 100
      } catch (error) {
        console.error('PNL calculation error:', error)
      }
    }

    return {
      success: true,
      stats: {
        totalTrades,
        tradesPerHour,
        lifiSwaps,
        p2pTrades,
        totalVolume,
        ...(botAddress && { totalPnl }),
      }
    }
  })

  // GET /api/deals/:id - Get deal details
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params
    
    const deal = await prisma.dealLog.findUnique({
      where: { id },
    })
    
    if (!deal) {
      return reply.status(404).send({ error: 'Deal not found' })
    }

    // Resolve pending status from LI.FI
    const resolvedStatus = await resolvePendingStatus(deal)
    
    return {
      success: true,
      deal: {
        id: deal.id,
        txHash: deal.txHash,
        regime: deal.regime,
        chainId: deal.chainId,
        fromToken: deal.fromToken,
        toToken: deal.toToken,
        fromAmount: deal.fromAmount,
        toAmount: deal.toAmount,
        botAddress: deal.botAddress,
        status: resolvedStatus,
        makerComment: deal.makerComment,
        takerComment: deal.takerComment,
        metadata: deal.metadata,
        createdAt: deal.createdAt,
      }
    }
  })
}
