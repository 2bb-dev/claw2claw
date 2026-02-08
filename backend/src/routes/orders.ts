/**
 * P2P Orders API Routes
 *
 * POST /api/orders         — Post a new P2P order (requires ENS)
 * GET  /api/orders         — List active P2P orders for a pool
 * DELETE /api/orders/:id   — Cancel an order
 * POST /api/orders/match   — Execute a P2P swap (match against orders)
 * GET  /api/orders/config  — Get P2P configuration info
 * GET  /api/orders/tokens  — List supported tokens
 * POST /api/orders/tokens  — Add a custom token
 * POST /api/orders/pools   — Initialize a new pool
 */
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { authenticateBot } from '../auth.js'
import { prisma } from '../db.js'
import {
  addToken,
  cancelP2POrder,
  executeP2PSwap,
  getActiveOrders,
  getAllActiveOrders,
  getKnownTokens,
  getP2PConfig,
  initializePool,
  isP2PConfigured,
  postP2POrder,
} from '../services/p2p.js'

// ── Types ──

interface PostOrderBody {
  sellToken: string     // symbol or address (e.g. "USDC", "WETH", "0x...")
  sellAmount: string    // raw amount in smallest unit
  buyToken: string      // symbol or address
  minBuyAmount: string  // minimum acceptable
  duration?: number     // seconds (default: 1 hour)
  comment?: string      // bot reasoning
}

interface MatchOrderBody {
  payToken: string       // token the taker is selling
  receiveToken: string   // token the taker wants
  payAmount: string      // raw amount
  comment?: string       // bot reasoning
}

interface CancelOrderBody {
  sellToken: string
  buyToken: string
}

interface AddTokenBody {
  address: string
  symbol: string
  name: string
  decimals: number
}

interface InitPoolBody {
  tokenA: string         // symbol or address
  tokenB: string         // symbol or address
  sqrtPriceX96?: string  // initial price (optional, defaults to 1:1)
}

/**
 * Check ENS requirement for P2P trading.
 * Returns error response if bot has no ENS, null if okay.
 */
function checkEnsGate(bot: { ensName: string | null }, reply: FastifyReply) {
  if (!bot.ensName) {
    return reply.status(403).send({
      error: 'ENS identity required for P2P trading',
      reason: 'P2P trades require verifiable bot identity via ENS.',
      action: 'Register with createEns: true, or update your bot to enable ENS',
      help: 'POST /api/bots/register with { "name": "your-bot", "createEns": true }',
    })
  }
  return null
}

export async function ordersRoutes(fastify: FastifyInstance) {

  // GET /api/orders/config — P2P configuration info (public)
  fastify.get('/config', async () => {
    return {
      success: true,
      p2p: getP2PConfig(),
    }
  })

  // GET /api/orders/tokens — List all supported tokens (public)
  fastify.get('/tokens', async () => {
    const tokens = getKnownTokens()
    return {
      success: true,
      tokens,
      count: tokens.length,
    }
  })

  // POST /api/orders/tokens — Add a custom token (authenticated)
  fastify.post<{ Body: AddTokenBody }>('/tokens', async (request: FastifyRequest<{ Body: AddTokenBody }>, reply: FastifyReply) => {
    const bot = await authenticateBot(request)
    if (!bot) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    const { address, symbol, name, decimals } = request.body

    if (!address || !symbol || !name || decimals === undefined) {
      return reply.status(400).send({
        error: 'Missing required fields: address, symbol, name, decimals',
      })
    }

    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return reply.status(400).send({ error: 'Invalid token address' })
    }

    try {
      addToken({ address: address as any, symbol, name, decimals })
      return {
        success: true,
        token: { address, symbol: symbol.toUpperCase(), name, decimals },
      }
    } catch (error) {
      return reply.status(500).send({
        error: 'Failed to add token',
        details: (error as Error).message,
      })
    }
  })

  // POST /api/orders/pools — Initialize a new pool (authenticated)
  fastify.post<{ Body: InitPoolBody }>('/pools', async (request: FastifyRequest<{ Body: InitPoolBody }>, reply: FastifyReply) => {
    const bot = await authenticateBot(request)
    if (!bot) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    if (!isP2PConfigured()) {
      return reply.status(503).send({ error: 'P2P trading not configured on this server' })
    }

    const { tokenA, tokenB, sqrtPriceX96 } = request.body

    if (!tokenA || !tokenB) {
      return reply.status(400).send({
        error: 'Missing required fields: tokenA, tokenB',
      })
    }

    try {
      const result = await initializePool(tokenA, tokenB, sqrtPriceX96)

      return {
        success: true,
        pool: result,
        explorer: `https://basescan.org/tx/${result.txHash}`,
      }
    } catch (error) {
      const msg = (error as Error).message
      // PoolAlreadyInitialized is not an error — pool exists and is ready
      if (msg.includes('already initialized') || msg.includes('PoolAlreadyInitialized')) {
        return {
          success: true,
          message: 'Pool already initialized and ready to use',
          pool: { tokenA, tokenB },
        }
      }
      console.error('[Orders] Pool initialization failed:', error)
      return reply.status(500).send({
        error: 'Failed to initialize pool',
        details: msg,
      })
    }
  })

  // GET /api/orders/detail/:id — Get a single P2P order deal by deal log ID or on-chain orderId (public)
  fastify.get<{ Params: { id: string } }>('/detail/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params

    // Known token decimals fallback
    const TOKEN_DECIMALS: Record<string, number> = {
      ETH: 18, WETH: 18, USDC: 6, USDT: 6, DAI: 18,
      WBTC: 8, CBBTC: 8, MATIC: 18, AVAX: 18, BNB: 18,
    }

    // Check if id is a numeric on-chain orderId
    const numericId = parseInt(id, 10)
    const isNumeric = !isNaN(numericId) && String(numericId) === id

    let deal: any = null

    if (isNumeric) {
      // Lookup by on-chain orderId → P2POrder → DealLog
      const p2pOrder = await prisma.p2POrder.findFirst({
        where: { onChainId: numericId },
      })
      if (p2pOrder?.txHash) {
        deal = await prisma.dealLog.findFirst({
          where: { txHash: p2pOrder.txHash, regime: 'p2p-post' },
        })
      }
    } else {
      // Try lookup by deal log UUID first
      deal = await prisma.dealLog.findUnique({ where: { id } })
      // If not a deal log, try as P2POrder UUID → txHash → DealLog
      if (!deal) {
        const p2pOrder = await prisma.p2POrder.findUnique({ where: { id } })
        if (p2pOrder?.txHash) {
          deal = await prisma.dealLog.findFirst({
            where: { txHash: p2pOrder.txHash, regime: 'p2p-post' },
          })
        }
      }
    }

    if (!deal || !deal.regime.startsWith('p2p')) {
      return reply.status(404).send({ error: 'Order not found' })
    }

    const meta = (deal.metadata as Record<string, unknown>) ?? {}

    // Resolve bot ENS name
    const wallet = await prisma.botWallet.findUnique({
      where: { walletAddress: deal.botAddress },
      include: { botAuth: { select: { ensName: true } } },
    })

    return {
      success: true,
      order: {
        id: deal.id,
        txHash: deal.txHash,
        regime: deal.regime,
        chainId: deal.chainId,
        fromToken: deal.fromToken,
        toToken: deal.toToken,
        fromAmount: deal.fromAmount,
        toAmount: deal.toAmount ?? (meta.minBuyAmount as string) ?? null,
        fromTokenDecimals: (meta.fromTokenDecimals as number) ?? TOKEN_DECIMALS[deal.fromToken.toUpperCase()] ?? 18,
        toTokenDecimals: (meta.toTokenDecimals as number) ?? TOKEN_DECIMALS[deal.toToken.toUpperCase()] ?? 18,
        orderId: (meta.orderId as number) ?? null,
        minBuyAmount: (meta.minBuyAmount as string) ?? null,
        duration: (meta.duration as number) ?? null,
        botAddress: deal.botAddress,
        botEnsName: wallet?.botAuth.ensName ?? null,
        status: deal.status,
        makerComment: deal.makerComment,
        takerComment: deal.takerComment,
        createdAt: deal.createdAt,
      },
    }
  })

  // GET /api/orders — List active P2P orders (public, read-only from chain)
  fastify.get<{ Querystring: { tokenA?: string; tokenB?: string } }>('/', async (request: FastifyRequest<{ Querystring: { tokenA?: string; tokenB?: string } }>, reply: FastifyReply) => {
    if (!isP2PConfigured()) {
      return reply.status(503).send({
        error: 'P2P trading not configured',
        reason: 'HOOK_ADMIN_PRIVATE_KEY environment variable not set',
      })
    }

    const { tokenA, tokenB } = request.query

    try {
      // If specific pool requested, query that pool; otherwise query ALL pools
      const orders = (tokenA || tokenB)
        ? await getActiveOrders(tokenA, tokenB)
        : await getAllActiveOrders()

      // Enrich with deal log IDs for linking to detail pages

      const onChainIds = orders.map(o => o.orderId)
      const p2pOrders = await prisma.p2POrder.findMany({
        where: { onChainId: { in: onChainIds } },
        select: { id: true, onChainId: true, txHash: true },
      })
      const txHashByOrderId = new Map(p2pOrders.map(o => [o.onChainId, o.txHash]))
      const p2pOrderIdByOnChainId = new Map(p2pOrders.map(o => [o.onChainId, o.id]))

      // Look up deal logs by txHash
      const txHashes = p2pOrders.map(o => o.txHash).filter(Boolean) as string[]
      const dealLogs = txHashes.length > 0
        ? await prisma.dealLog.findMany({
            where: { txHash: { in: txHashes }, regime: 'p2p-post' },
            select: { id: true, txHash: true },
          })
        : []
      const dealLogIdByTxHash = new Map(dealLogs.map(d => [d.txHash, d.id]))

      const enrichedOrders = orders
        .map(o => {
          const txHash = txHashByOrderId.get(o.orderId)
          const dealLogId = txHash ? dealLogIdByTxHash.get(txHash) : undefined
          return { ...o, dealLogId: dealLogId ?? p2pOrderIdByOnChainId.get(o.orderId) ?? null }
        })

      return {
        success: true,
        pool: (tokenA || tokenB)
          ? { tokenA: tokenA || 'WETH', tokenB: tokenB || 'USDC' }
          : { tokenA: 'ALL', tokenB: 'ALL' },
        orders: enrichedOrders,
        count: orders.length,
        activeCount: orders.filter(o => o.active && !o.isExpired).length,
      }
    } catch (error) {
      console.error('[Orders] Failed to fetch orders:', error)
      return reply.status(500).send({
        error: 'Failed to fetch P2P orders',
        details: (error as Error).message,
      })
    }
  })

  // POST /api/orders — Post a new P2P order (authenticated + ENS required)
  fastify.post<{ Body: PostOrderBody }>('/', async (request: FastifyRequest<{ Body: PostOrderBody }>, reply: FastifyReply) => {
    const bot = await authenticateBot(request)

    if (!bot) {
      return reply.status(401).send({
        error: 'Unauthorized. Provide valid API key in Authorization header.',
      })
    }

    // ENS gate — P2P requires verifiable identity
    const ensError = checkEnsGate(bot, reply)
    if (ensError) return ensError

    if (!isP2PConfigured()) {
      return reply.status(503).send({ error: 'P2P trading not configured on this server' })
    }

    const { sellToken, sellAmount, buyToken, minBuyAmount, duration = 3600, comment } = request.body

    if (!sellToken || !sellAmount || !buyToken || !minBuyAmount) {
      return reply.status(400).send({
        error: 'Missing required fields: sellToken, sellAmount, buyToken, minBuyAmount',
      })
    }

    // Validate duration
    if (duration < 60 || duration > 30 * 24 * 3600) {
      return reply.status(400).send({
        error: 'Duration must be between 60 seconds and 30 days',
      })
    }

    if (!bot.wallet?.walletAddress || !bot.wallet?.encryptedWalletKey) {
      return reply.status(400).send({
        error: 'Bot has no wallet configured. Register with createWallet: true.',
      })
    }

    try {
      const result = await postP2POrder({
        sellToken,
        sellAmount,
        buyToken,
        minBuyAmount,
        duration,
        encryptedPrivateKey: bot.wallet.encryptedWalletKey,
        botAddress: bot.wallet.walletAddress,
        comment,
      })

      return {
        success: true,
        order: result,
        explorer: `https://basescan.org/tx/${result.txHash}`,
      }
    } catch (error) {
      console.error('[Orders] Post order failed:', error)
      return reply.status(500).send({
        error: 'Failed to post P2P order',
        details: (error as Error).message,
      })
    }
  })

  // DELETE /api/orders/:id — Cancel an order (authenticated, must be maker)
  fastify.delete<{ Params: { id: string }; Body: CancelOrderBody }>('/:id', async (request: FastifyRequest<{ Params: { id: string }; Body: CancelOrderBody }>, reply: FastifyReply) => {
    const bot = await authenticateBot(request)

    if (!bot) {
      return reply.status(401).send({
        error: 'Unauthorized. Provide valid API key in Authorization header.',
      })
    }

    if (!bot.wallet?.walletAddress || !bot.wallet?.encryptedWalletKey) {
      return reply.status(400).send({ error: 'Bot has no wallet configured.' })
    }

    const orderId = parseInt(request.params.id, 10)
    if (isNaN(orderId)) {
      return reply.status(400).send({ error: 'Invalid order ID' })
    }

    const { sellToken, buyToken } = request.body || {}
    if (!sellToken || !buyToken) {
      return reply.status(400).send({
        error: 'Missing required body fields: sellToken, buyToken (needed to identify the pool)',
      })
    }

    try {
      const result = await cancelP2POrder({
        orderId,
        sellToken,
        buyToken,
        encryptedPrivateKey: bot.wallet.encryptedWalletKey,
        botAddress: bot.wallet.walletAddress,
      })

      return {
        success: true,
        cancelled: {
          orderId,
          txHash: result.txHash,
        },
        explorer: `https://basescan.org/tx/${result.txHash}`,
      }
    } catch (error) {
      console.error('[Orders] Cancel order failed:', error)
      return reply.status(500).send({
        error: 'Failed to cancel P2P order',
        details: (error as Error).message,
      })
    }
  })

  // POST /api/orders/match — Execute a P2P swap (authenticated + ENS required)
  fastify.post<{ Body: MatchOrderBody }>('/match', async (request: FastifyRequest<{ Body: MatchOrderBody }>, reply: FastifyReply) => {
    const bot = await authenticateBot(request)

    if (!bot) {
      return reply.status(401).send({
        error: 'Unauthorized. Provide valid API key in Authorization header.',
      })
    }

    // ENS gate
    const ensError = checkEnsGate(bot, reply)
    if (ensError) return ensError

    if (!isP2PConfigured()) {
      return reply.status(503).send({ error: 'P2P trading not configured on this server' })
    }

    const { payToken, receiveToken, payAmount, comment } = request.body

    if (!payToken || !receiveToken || !payAmount) {
      return reply.status(400).send({
        error: 'Missing required fields: payToken, receiveToken, payAmount',
      })
    }

    if (!bot.wallet?.walletAddress || !bot.wallet?.encryptedWalletKey) {
      return reply.status(400).send({
        error: 'Bot has no wallet configured. Register with createWallet: true.',
      })
    }

    try {
      const result = await executeP2PSwap({
        payToken,
        receiveToken,
        payAmount,
        encryptedPrivateKey: bot.wallet.encryptedWalletKey,
        botAddress: bot.wallet.walletAddress,
        comment,
      })

      return {
        success: true,
        swap: result,
        explorer: `https://basescan.org/tx/${result.txHash}`,
      }
    } catch (error) {
      console.error('[Orders] Match/swap failed:', error)
      return reply.status(500).send({
        error: 'P2P swap failed',
        details: (error as Error).message,
      })
    }
  })
}
