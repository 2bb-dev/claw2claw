import { getToken, type ChainId as LiFiChainId } from '@lifi/sdk'
import { FastifyInstance } from 'fastify'
import { formatUnits, type Hex } from 'viem'
import { CHAIN_IDS } from '../config/chains.js'
import { prisma } from '../db.js'

import { getSwapStatus } from '../services/lifi.js'
import { resolveToken } from '../services/p2p.js'
import { createBlockchainClient } from '../services/wallet.js'

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
  } catch (error: any) {
    // LI.FI 404 = tx not handled by LI.FI contracts → mark as failed to stop retrying
    if (error?.cause?.status === 404 || error?.status === 404) {
      console.warn(`[resolvePendingStatus] Deal ${deal.id} not found by LI.FI, marking as failed`)
      await prisma.dealLog.update({
        where: { id: deal.id },
        data: { status: 'failed' },
      })
      return 'failed'
    }
    console.error(`[resolvePendingStatus] Error checking deal ${deal.id}:`, error)
  }

  return deal.status
}

/**
 * For completed P2P deals missing toAmount, fetch the tx receipt from
 * the blockchain, parse ERC20 Transfer logs, and backfill the DB.
 */
async function resolveP2PToAmount(deal: {
  id: string
  txHash: string
  toToken: string
  botAddress: string
  toAmount: string | null
  regime: string
  status: string
}): Promise<string | null> {
  if (deal.toAmount) return deal.toAmount
  if (!deal.regime.startsWith('p2p') || deal.status !== 'completed') return null
  if (deal.txHash.startsWith('pending-')) return null

  try {
    const tokenInfo = resolveToken(deal.toToken)
    const publicClient = createBlockchainClient(CHAIN_IDS.BASE)
    const receipt = await publicClient.getTransactionReceipt({ hash: deal.txHash as Hex })

    const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
    const botAddrPadded = `0x${deal.botAddress.toLowerCase().replace('0x', '').padStart(64, '0')}`

    for (const log of receipt.logs) {
      if (
        log.address.toLowerCase() === tokenInfo.address.toLowerCase() &&
        log.topics[0] === TRANSFER_TOPIC &&
        log.topics[2]?.toLowerCase() === botAddrPadded
      ) {
        const amount = BigInt(log.data).toString()
        // Backfill DB so we don't need to fetch again
        await prisma.dealLog.update({
          where: { id: deal.id },
          data: { toAmount: amount },
        })
        console.log(`[deals] Backfilled toAmount for deal ${deal.id}: ${amount}`)
        return amount
      }
    }
  } catch (err) {
    console.error(`[deals] Failed to resolve toAmount for deal ${deal.id}:`, err)
  }

  return null
}

// Known token decimals (fallback to 18)
const TOKEN_DECIMALS: Record<string, number> = {
  ETH: 18, WETH: 18, USDC: 6, USDT: 6, DAI: 18,
  WBTC: 8, CBBTC: 8, MATIC: 18, AVAX: 18, BNB: 18, ARB: 18, OP: 18,
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

    // Exclude pending P2P posts — they show as open orders, not deals
    const filteredDeals = deals.filter(d => !(d.regime === 'p2p-post' && d.status === 'pending'))

    // Resolve pending deals' statuses in parallel (skip P2P — they aren't LI.FI txs)
    const pendingDeals = filteredDeals.filter(d => d.status === 'pending' && !d.txHash.startsWith('pending-') && !d.regime?.startsWith('p2p'))
    const resolvedStatuses = await Promise.all(
      pendingDeals.map(d => resolvePendingStatus(d))
    )
    const statusMap = new Map(pendingDeals.map((d, i) => [d.id, resolvedStatuses[i]]))

    // Resolve bot addresses to ENS names via BotWallet → BotAuth
    const uniqueAddresses = [...new Set(deals.map(d => d.botAddress))]
    const wallets = await prisma.botWallet.findMany({
      where: { walletAddress: { in: uniqueAddresses } },
      include: { botAuth: { select: { ensName: true } } },
    })
    const ensMap = new Map(
      wallets
        .filter(w => w.botAuth.ensName)
        .map(w => [w.walletAddress, w.botAuth.ensName!])
    )
    
    // Resolve missing toAmounts for completed P2P deals (both p2p and p2p-post)
    const toAmountPromises = filteredDeals.map(async (deal) => {
      if (deal.toAmount) return deal.toAmount
      if (!deal.regime.startsWith('p2p') || deal.status !== 'completed') return deal.toAmount

      // For taker deals (p2p), resolve from tx receipt
      if (deal.regime === 'p2p') {
        return resolveP2PToAmount(deal)
      }

      // For maker deals (p2p-post), resolve from match tx receipt
      if (deal.regime === 'p2p-post') {
        const meta = (deal.metadata as Record<string, unknown>) ?? {}
        const matchTxHash = meta.matchTxHash as string | undefined
        if (!matchTxHash) return deal.toAmount
        try {
          const tokenInfo = resolveToken(deal.toToken)
          const publicClient = createBlockchainClient(CHAIN_IDS.BASE)
          const receipt = await publicClient.getTransactionReceipt({ hash: matchTxHash as Hex })
          const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
          const botAddrPadded = `0x${deal.botAddress.toLowerCase().replace('0x', '').padStart(64, '0')}`
          for (const log of receipt.logs) {
            if (
              log.address.toLowerCase() === tokenInfo.address.toLowerCase() &&
              log.topics[0] === TRANSFER_TOPIC &&
              log.topics[2]?.toLowerCase() === botAddrPadded
            ) {
              const amount = BigInt(log.data).toString()
              await prisma.dealLog.update({ where: { id: deal.id }, data: { toAmount: amount } })
              return amount
            }
          }
        } catch (err) {
          console.error(`[deals] Failed to resolve toAmount for p2p-post deal ${deal.id}:`, err)
        }
      }
      return deal.toAmount
    })
    const resolvedToAmounts = await Promise.all(toAmountPromises)

    return {
      success: true,
      deals: filteredDeals.map((deal, i) => {
        const meta = (deal.metadata as Record<string, unknown>) ?? {}
        return {
          id: deal.id,
          txHash: deal.txHash,
          regime: deal.regime,
          chainId: deal.chainId,
          fromToken: deal.fromToken,
          toToken: deal.toToken,
          fromAmount: deal.fromAmount,
          toAmount: resolvedToAmounts[i] ?? deal.toAmount ?? (meta.minBuyAmount as string) ?? null,
          fromTokenDecimals: (meta.fromTokenDecimals as number) ?? TOKEN_DECIMALS[deal.fromToken.toUpperCase()] ?? 18,
          toTokenDecimals: (meta.toTokenDecimals as number) ?? TOKEN_DECIMALS[deal.toToken.toUpperCase()] ?? 18,
          botAddress: deal.botAddress,
          botEnsName: ensMap.get(deal.botAddress) ?? null,
          status: statusMap.get(deal.id) ?? deal.status,
          makerComment: deal.makerComment,
          takerComment: deal.takerComment,
          createdAt: deal.createdAt,
        }
      })
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

        // Fetch prices from LI.FI
        const prices: Record<string, number> = {}
        for (const symbol of tokenSymbols) {
          try {
            const chainId = deals[0].chainId || 1
            const token = await getToken(chainId as LiFiChainId, symbol)
            prices[symbol] = parseFloat(token.priceUSD || '0')
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

    // Resolve bot ENS name
    const wallet = await prisma.botWallet.findUnique({
      where: { walletAddress: deal.botAddress },
      include: { botAuth: { select: { ensName: true } } },
    })
    
    const meta = (deal.metadata as Record<string, unknown>) ?? {}

    // Resolve missing toAmount for completed P2P deals from blockchain
    let resolvedToAmount = await resolveP2PToAmount(deal)

    // For completed p2p-post deals, resolve toAmount from the match transaction
    if (!resolvedToAmount && deal.regime === 'p2p-post' && deal.status === 'completed' && meta.matchTxHash) {
      try {
        const tokenInfo = resolveToken(deal.toToken)
        const publicClient = createBlockchainClient(CHAIN_IDS.BASE)
        const receipt = await publicClient.getTransactionReceipt({ hash: meta.matchTxHash as Hex })
        const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
        const botAddrPadded = `0x${deal.botAddress.toLowerCase().replace('0x', '').padStart(64, '0')}`
        for (const log of receipt.logs) {
          if (
            log.address.toLowerCase() === tokenInfo.address.toLowerCase() &&
            log.topics[0] === TRANSFER_TOPIC &&
            log.topics[2]?.toLowerCase() === botAddrPadded
          ) {
            resolvedToAmount = BigInt(log.data).toString()
            await prisma.dealLog.update({
              where: { id: deal.id },
              data: { toAmount: resolvedToAmount },
            })
            break
          }
        }
      } catch (err) {
        console.error(`[deals] Failed to resolve toAmount for p2p-post deal ${deal.id}:`, err)
      }
    }

    // Resolve maker/taker addresses for P2P deals
    let makerAddress: string | null = null
    let takerAddress: string | null = null

    if (deal.regime === 'p2p-post') {
      // Maker posted this order
      makerAddress = deal.botAddress
      takerAddress = (meta.matchedBy as string) ?? null
    } else if (deal.regime === 'p2p') {
      // Taker executed this swap
      takerAddress = deal.botAddress
      // Find the maker by looking at matched P2P orders for this tx
      try {
        const matchedOrder = await prisma.p2POrder.findFirst({
          where: { matchTxHash: deal.txHash },
        })
        if (matchedOrder) {
          makerAddress = matchedOrder.maker
        }
      } catch (err) {
        console.error(`[deals] Failed to resolve maker address for deal ${deal.id}:`, err)
      }
    }

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
        toAmount: resolvedToAmount ?? deal.toAmount ?? (meta.minBuyAmount as string) ?? null,
        fromTokenDecimals: (meta.fromTokenDecimals as number) ?? TOKEN_DECIMALS[deal.fromToken.toUpperCase()] ?? 18,
        toTokenDecimals: (meta.toTokenDecimals as number) ?? TOKEN_DECIMALS[deal.toToken.toUpperCase()] ?? 18,
        botAddress: deal.botAddress,
        botEnsName: wallet?.botAuth.ensName ?? null,
        makerAddress,
        takerAddress,
        status: resolvedStatus,
        makerComment: deal.makerComment,
        takerComment: deal.takerComment,
        metadata: deal.metadata,
        createdAt: deal.createdAt,
      }
    }
  })
}
