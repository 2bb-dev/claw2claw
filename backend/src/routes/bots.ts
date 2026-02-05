import type { Prisma } from '@prisma/client'
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Address } from 'viem'
import { authenticateBot, generateApiKey } from '../auth.js'
import { prisma } from '../db.js'
import { generateBotBasenameSubdomain, getBasenameProfile, registerBotBasename, resolveBasenameToAddress } from '../services/basenames.js'
import { createBotWallet, getWalletBalance, isAAConfigured } from '../services/wallet.js'

interface RegisterBody {
  name: string
  humanOwner: string
  strategy?: Record<string, unknown>
  createWallet?: boolean  // Optional: create AA wallet
}

interface Asset {
  symbol: string
  amount: number
  usdPrice: number
}

export async function botsRoutes(fastify: FastifyInstance) {
  // GET /api/bots - List all bots
  fastify.get('/', async () => {
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
    
    return {
      success: true,
      bots: bots.map(bot => {
        const portfolioValue = bot.assets.reduce(
          (total: number, asset: Asset) => total + (asset.amount * asset.usdPrice), 
          0
        )
        return {
          id: bot.id,
          name: bot.name,
          ensName: bot.ensName,
          walletAddress: bot.walletAddress,
          assets: bot.assets.map((a: Asset) => ({
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
    }
  })

  // GET /api/bots/:id - Get bot by ID (for portfolio page)
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params
    
    const bot = await prisma.bot.findUnique({
      where: { id },
      include: {
        assets: true,
        orders: {
          where: { status: 'open' },
          orderBy: { createdAt: 'desc' },
          take: 20
        },
        _count: {
          select: {
            orders: true,
            dealsAsMaker: true,
            dealsAsTaker: true
          }
        }
      }
    })
    
    if (!bot) {
      return reply.status(404).send({ error: 'Bot not found' })
    }
    
    const portfolioValue = bot.assets.reduce(
      (total: number, asset: Asset) => total + (asset.amount * asset.usdPrice), 
      0
    )
    
    // Fetch Basename profile if bot has a name
    let ensProfile = null
    if (bot.ensName) {
      ensProfile = await getBasenameProfile(bot.ensName)
    }
    
    const totalDeals = bot._count.dealsAsMaker + bot._count.dealsAsTaker
    
    return {
      success: true,
      bot: {
        id: bot.id,
        name: bot.name,
        ensName: bot.ensName,
        walletAddress: bot.walletAddress,
        ensProfile,
        assets: bot.assets.map((a: Asset) => ({
          symbol: a.symbol,
          amount: a.amount,
          usdValue: parseFloat((a.amount * a.usdPrice).toFixed(2)),
          percentOfPortfolio: portfolioValue > 0 
            ? parseFloat(((a.amount * a.usdPrice / portfolioValue) * 100).toFixed(1))
            : 0
        })),
        totalPortfolioValue: parseFloat(portfolioValue.toFixed(2)),
        openOrders: bot.orders.map(order => ({
          id: order.id,
          type: order.type,
          tokenPair: order.tokenPair,
          price: order.price,
          amount: order.amount,
          createdAt: order.createdAt
        })),
        stats: {
          totalOrders: bot._count.orders,
          totalDeals,
          successRate: bot._count.orders > 0 
            ? parseFloat(((totalDeals / bot._count.orders) * 100).toFixed(1))
            : 0
        },
        createdAt: bot.createdAt,
      }
    }
  })

  // GET /api/bots/me - Get authenticated bot's profile
  fastify.get('/me', async (request: FastifyRequest, reply: FastifyReply) => {
    const bot = await authenticateBot(request)
    
    if (!bot) {
      return reply.status(401).send({
        error: 'Unauthorized. Provide valid API key in Authorization header.'
      })
    }
    
    const portfolioValue = bot.assets.reduce(
      (total: number, asset: Asset) => total + (asset.amount * asset.usdPrice), 
      0
    )
    
    // Get wallet balance if configured
    let walletBalance = null
    if (bot.walletAddress) {
      try {
        const balance = await getWalletBalance(bot.walletAddress)
        walletBalance = balance.toString()
      } catch {
        // Wallet balance fetch failed, continue without it
      }
    }
    
    return {
      success: true,
      bot: {
        id: bot.id,
        name: bot.name,
        humanOwner: bot.humanOwner,
        ensName: bot.ensName,
        walletAddress: bot.walletAddress,
        walletBalance,
        strategy: bot.strategy,
        assets: bot.assets.map((a: Asset) => ({
          symbol: a.symbol,
          amount: a.amount,
          usdValue: parseFloat((a.amount * a.usdPrice).toFixed(2))
        })),
        totalPortfolioValue: parseFloat(portfolioValue.toFixed(2)),
        createdAt: bot.createdAt,
      }
    }
  })

  // POST /api/bots/register - Register a new bot
  fastify.post<{ Body: RegisterBody }>('/register', async (request, reply) => {
    try {
      const { name, humanOwner, strategy, createWallet = true } = request.body
      
      if (!name || !humanOwner) {
        return reply.status(400).send({
          error: 'name and humanOwner are required'
        })
      }
      
      const apiKey = generateApiKey()
      
      // Create AA wallet if requested and configured
      let walletAddress: string | null = null
      let encryptedWalletKey: string | null = null
      
      if (createWallet && isAAConfigured()) {
        try {
          const wallet = await createBotWallet()
          walletAddress = wallet.walletAddress
          encryptedWalletKey = wallet.encryptedPrivateKey
        } catch (error) {
          console.error('Wallet creation failed:', error)
          // Continue without wallet - can be created later
        }
      }
      
      // Register on-chain Basename (or fallback to off-chain subdomain)
      let ensName: string
      let ensRegistrationTx: string | null = null
      
      if (walletAddress) {
        // Register Basename with wallet as owner
        const basenameResult = await registerBotBasename(name, walletAddress as Address)
        ensName = basenameResult.ensName
        ensRegistrationTx = basenameResult.txHash || null
        
        if (basenameResult.error && !basenameResult.success) {
          console.warn('Basename registration issue:', basenameResult.error)
        }
      } else {
        // No wallet - use off-chain subdomain
        ensName = generateBotBasenameSubdomain(name)
      }
      
      // Create bot with empty assets - real assets come from on-chain deposits
      const bot = await prisma.bot.create({
        data: {
          name,
          apiKey,
          humanOwner,
          ensName,
          walletAddress,
          encryptedWalletKey,
          strategy: (strategy || {}) as Prisma.InputJsonValue,
        },
        include: {
          assets: true
        }
      })
      
      return {
        success: true,
        bot: {
          id: bot.id,
          apiKey: bot.apiKey,
          ensName: bot.ensName,
          wallet: bot.walletAddress,
        },
        important: "SAVE YOUR API KEY! You need it for all requests.",
        ...(walletAddress && {
          walletInfo: `Your bot wallet is ready. Deposit assets to: ${walletAddress}`
        }),
        ...(ensRegistrationTx && {
          ensRegistration: {
            txHash: ensRegistrationTx,
            name: ensName,
            network: 'base-sepolia'
          }
        })
      }
    } catch (error) {
      console.error('Registration error:', error)
      return reply.status(500).send({ error: 'Registration failed' })
    }
  })

  // GET /api/bots/:id/wallet - Get wallet details
  fastify.get<{ Params: { id: string } }>('/:id/wallet', async (request, reply) => {
    const bot = await authenticateBot(request)
    
    if (!bot) {
      return reply.status(401).send({
        error: 'Unauthorized. Provide valid API key in Authorization header.'
      })
    }
    
    if (request.params.id !== bot.id) {
      return reply.status(403).send({ error: 'Access denied' })
    }
    
    if (!bot.walletAddress) {
      return reply.status(404).send({ error: 'No wallet configured for this bot' })
    }
    
    try {
      const balance = await getWalletBalance(bot.walletAddress)
      
      return {
        success: true,
        wallet: {
          address: bot.walletAddress,
          ensName: bot.ensName,
          balance: balance.toString(),
          balanceFormatted: `${(Number(balance) / 1e18).toFixed(6)} ETH`
        }
      }
    } catch (error) {
      console.error('Wallet balance fetch error:', error)
      return reply.status(500).send({ error: 'Failed to fetch wallet balance' })
    }
  })

  // POST /api/ens/resolve - Resolve ENS name to address
  fastify.post<{ Body: { ensName: string } }>('/ens/resolve', async (request, reply) => {
    const { ensName } = request.body
    
    if (!ensName) {
      return reply.status(400).send({ error: 'ensName is required' })
    }
    
    const address = await resolveBasenameToAddress(ensName)
    
    if (!address) {
      return reply.status(404).send({ error: 'Basename not found or has no address' })
    }
    
    return {
      success: true,
      ensName,
      address
    }
  })
}

