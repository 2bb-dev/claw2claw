import { getWalletBalances } from '@lifi/sdk'
import { Prisma } from '@prisma/client'
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { formatUnits, isAddress } from 'viem'
import { authenticateBot, generateApiKey } from '../auth.js'
import { prisma } from '../db.js'
import { cached, invalidate } from '../services/cache.js'
import {
  checkSubdomainExists,
  createBotSubdomain,
  getBotEnsName,
  getBotProfile,
  getDefaultBotRecords,
  getEnsConfig,
  getTextRecord,
  isEnsConfigured,
  resolveEnsName,
  reverseResolve,
  setBotTextRecords,
} from '../services/ens.js'
import { createBotWallet, getWalletBalance, isAAConfigured } from '../services/wallet.js'
import { isP2PConfigured } from '../services/p2p.js'

interface RegisterBody {
  name: string
  createWallet?: boolean
  createEns?: boolean  // Optional: create ENS subdomain for bot
}

export async function botsRoutes(fastify: FastifyInstance) {
  // GET /api/bots - List all registered bots (public)
  fastify.get('/', async () => {
    const bots = await prisma.botAuth.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        ensName: true,
        wallet: { select: { walletAddress: true } },
        createdAt: true,
      }
    })
    
    return {
      success: true,
      bots: bots.map(bot => ({
        id: bot.id,
        ensName: bot.ensName,
        walletAddress: bot.wallet?.walletAddress || null,
        createdAt: bot.createdAt,
      }))
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
    
    // Fetch wallet balances and ENS profile in parallel
    const walletAddress = bot.wallet?.walletAddress
    const ensName: string | null = bot.ensName || null

    const [balanceResult, ensResult, p2pResult] = await Promise.allSettled([
      // LI.FI multi-chain portfolio (fresh data, API key handles rate limits)
      walletAddress
        ? getWalletBalances(walletAddress)
        : Promise.resolve(null),
      // ENS on-chain profile (cached 5 min — rarely changes)
      ensName
        ? cached(`ens:profile:${ensName}`, 300, () => getBotProfile(ensName))
        : Promise.resolve(null),
      // Active P2P orders (fast DB query — shows escrowed funds)
      walletAddress
        ? prisma.p2POrder.findMany({
            where: { maker: walletAddress, status: 'active' },
            orderBy: { createdAt: 'desc' },
          })
        : Promise.resolve([]),
    ])

    // Process wallet balances
    let walletBalance: {
      totalUSD: number
      assets: {
        chainId: number; symbol: string; name: string; amount: string;
        amountFormatted: string; priceUSD: string; valueUSD: number;
        logoURI?: string; decimals: number;
      }[]
    } | null = null

    if (balanceResult.status === 'fulfilled' && balanceResult.value) {
      const balancesByChain = balanceResult.value as Record<number, any[]>
      const assets: {
        chainId: number; symbol: string; name: string; amount: string;
        amountFormatted: string; priceUSD: string; valueUSD: number;
        logoURI?: string; decimals: number;
      }[] = []
      for (const [chainId, tokens] of Object.entries(balancesByChain)) {
        for (const token of tokens) {
          if (!token.amount || token.amount === '0') continue
          const amountFormatted = formatUnits(BigInt(token.amount), token.decimals)
          const priceUSD = token.priceUSD || '0'
          const valueUSD = parseFloat(amountFormatted) * parseFloat(priceUSD)
          if (valueUSD < 0.01) continue

          assets.push({
            chainId: Number(chainId),
            symbol: token.symbol,
            name: token.name,
            amount: token.amount,
            amountFormatted: parseFloat(amountFormatted).toLocaleString('en-US', { maximumFractionDigits: 6 }),
            priceUSD,
            valueUSD: Math.round(valueUSD * 100) / 100,
            logoURI: token.logoURI,
            decimals: token.decimals,
          })
        }
      }
      assets.sort((a, b) => b.valueUSD - a.valueUSD)
      const totalUSD = assets.reduce((sum, a) => sum + a.valueUSD, 0)
      walletBalance = { totalUSD: Math.round(totalUSD * 100) / 100, assets }
    }

    const ensProfile = ensResult.status === 'fulfilled' ? ensResult.value : null

    // Active P2P orders (escrowed funds the bot should know about)
    const activeP2POrders = p2pResult.status === 'fulfilled' && Array.isArray(p2pResult.value)
      ? (p2pResult.value as any[]).map((o) => ({
          orderId: o.onChainId,
          sellToken0: o.sellToken0,
          amountEscrowed: o.amountIn,
          minAmountOut: o.minAmountOut,
          expiry: o.expiry,
          status: o.status,
          txHash: o.txHash,
        }))
      : []

    // P2P trading readiness
    const hasWallet = !!walletAddress
    const hasEns = !!ensName
    const p2pConfigured = isP2PConfigured()
    const p2pEnabled = hasWallet && hasEns && p2pConfigured

    let p2pStatus: string
    if (p2pEnabled) {
      p2pStatus = 'ready'
    } else if (!p2pConfigured) {
      p2pStatus = 'P2P not configured on this server'
    } else if (!hasWallet) {
      p2pStatus = 'Wallet required — register with createWallet: true'
    } else {
      p2pStatus = 'ENS identity required — register with createEns: true, or ask your operator to enable ENS for P2P trading'
    }

    return {
      success: true,
      bot: {
        id: bot.id,
        ensName,
        walletAddress: walletAddress || null,
        walletBalance,
        ensProfile,
        p2pEnabled,
        p2pStatus,
        activeP2POrders,
        createdAt: bot.createdAt,
      }
    }
  })

  // POST /api/bots/register - Register a new bot
  fastify.post<{ Body: RegisterBody }>('/register', async (request, reply) => {
    try {
      const { name, createWallet = true, createEns = false } = request.body
      
      if (!name) {
        return reply.status(400).send({
          error: 'name is required'
        })
      }

      // ENS requires a real wallet — reject upfront if wallet won't be created
      if (createEns && !createWallet) {
        return reply.status(400).send({
          error: 'createWallet is required when createEns is true (ENS addr record needs a real address)'
        })
      }
      
      const apiKey = generateApiKey()
      
      // Create AA wallet if requested and configured
      let walletAddress: string | null = null
      let encryptedWalletKey: string | null = null
      
      let walletError: string | null = null
      
      if (createWallet && isAAConfigured()) {
        try {
          const wallet = await createBotWallet()
          walletAddress = wallet.walletAddress
          encryptedWalletKey = wallet.encryptedPrivateKey
        } catch (error) {
          console.error('Wallet creation failed:', error)
          walletError = error instanceof Error ? error.message : String(error)
        }
      }
      
      // Store in DB immediately — fast response, ENS minting happens async
      const createData: Prisma.BotAuthCreateInput = {
        apiKey,
        ...(walletAddress && encryptedWalletKey && {
          wallet: {
            create: { walletAddress, encryptedWalletKey },
          },
        }),
      }

      const bot = await prisma.botAuth.create({
        data: createData,
        include: { wallet: true },
      })

      // Determine ENS eligibility
      let ensStatus: string | null = null

      if (createEns && !isEnsConfigured()) {
        ensStatus = 'skipped: ENS_DEPLOYER_PRIVATE_KEY not configured'
      } else if (createEns && !walletAddress) {
        ensStatus = 'skipped: wallet creation failed — ENS requires a wallet address'
      } else if (createEns && isEnsConfigured() && walletAddress) {
        // Check if name is already taken (DB first, then on-chain)
        const desiredEnsName = getBotEnsName(name)

        const existingBot = await prisma.botAuth.findFirst({
          where: { ensName: desiredEnsName },
        })
        if (existingBot) {
          return reply.status(409).send({
            error: `ENS name '${desiredEnsName}' is already taken by another bot`,
          })
        }

        // On-chain check (authoritative — catches names minted outside this backend)
        const existsOnChain = await checkSubdomainExists(name)
        if (existsOnChain) {
          return reply.status(409).send({
            error: `ENS subdomain '${desiredEnsName}' already exists on-chain`,
          })
        }

        ensStatus = 'minting — check /api/bots/me for status'

        // Fire-and-forget: mint ENS subdomain in the background
        // Updates the DB record when the on-chain tx confirms
        ;(async () => {
          try {
            const result = await createBotSubdomain(name, walletAddress)
            console.log(`[ENS] Bot ${name} registered as ${result.ensName} (tx: ${result.txHash})`)

            // Update DB with ENS name
            await prisma.botAuth.update({
              where: { id: bot.id },
              data: { ensName: result.ensName },
            })

            // Set default text records (best-effort)
            try {
              const defaultRecords = getDefaultBotRecords(name)
              await setBotTextRecords(result.ensName, defaultRecords)
              console.log(`[ENS] Text records set for ${result.ensName}`)
            } catch (error) {
              console.error(`[ENS] Text record setup failed for ${result.ensName}:`, error)
            }
          } catch (error) {
            console.error(`[ENS] Subdomain creation failed for bot ${bot.id}:`, error)
          }
        })()
      }
      
      return {
        success: true,
        bot: {
          id: bot.id,
          apiKey: bot.apiKey,
          ensName: null, // Will be populated async — check /api/bots/me
          wallet: bot.wallet?.walletAddress || null,
        },
        ...(ensStatus && { ensStatus }),
        important: "SAVE YOUR API KEY! You need it for all requests.",
        ...(walletAddress && {
          walletInfo: `Your bot wallet is ready. Deposit assets to: ${walletAddress}`
        }),
        ...(walletError && { walletError }),
        ...(createEns && isEnsConfigured() && walletAddress && {
          ensInfo: 'ENS subdomain is being minted on-chain. Poll GET /api/bots/me to check when ensName is ready.',
        }),
      }
    } catch (error) {
      console.error('Registration error:', error)
      return reply.status(500).send({ error: 'Registration failed' })
    }
  })

  // GET /api/bots/:id/wallet - Get wallet details (public)
  fastify.get<{ Params: { id: string } }>('/:id/wallet', async (request, reply) => {
    const { id } = request.params
    
    const bot = await prisma.botAuth.findUnique({
      where: { id },
      select: {
        id: true,
        ensName: true,
        wallet: { select: { walletAddress: true } },
        createdAt: true,
      }
    })
    
    if (!bot) {
      return reply.status(404).send({ error: 'Bot not found' })
    }
    
    const walletAddress = bot.wallet?.walletAddress
    if (!walletAddress) {
      return reply.status(404).send({ error: 'No wallet configured for this bot' })
    }
    
    try {
      const balance = await getWalletBalance(walletAddress)
      
      return {
        success: true,
        bot: {
          id: bot.id,
          ensName: bot.ensName,
          createdAt: bot.createdAt,
        },
        wallet: {
          address: walletAddress,
          ensName: bot.ensName || null,
          balance: balance.formatted,
          symbol: balance.symbol,
          balanceFormatted: `${parseFloat(balance.formatted).toFixed(6)} ${balance.symbol}`
        }
      }
    } catch (error) {
      console.error('Wallet balance fetch error:', error)
      return reply.status(500).send({ error: 'Failed to fetch wallet balance' })
    }
  })

  // GET /api/bots/assets/:address - Get all token balances for a wallet (via LI.FI)
  fastify.get<{ Params: { address: string } }>('/assets/:address', async (request, reply) => {
    const { address } = request.params

    if (!isAddress(address)) {
      return reply.status(400).send({ error: 'Invalid Ethereum address' })
    }

    try {
      const balancesByChain = await getWalletBalances(address) as Record<number, any[]>

      // Flatten all chains into a single sorted list
      const assets: {
        chainId: number
        symbol: string
        name: string
        address: string
        amount: string
        amountFormatted: string
        priceUSD: string
        valueUSD: number
        logoURI?: string
        decimals: number
      }[] = []

      for (const [chainId, tokens] of Object.entries(balancesByChain)) {
        for (const token of tokens) {
          if (!token.amount || token.amount === '0') continue
          const amountFormatted = formatUnits(BigInt(token.amount), token.decimals)
          const priceUSD = token.priceUSD || '0'
          const valueUSD = parseFloat(amountFormatted) * parseFloat(priceUSD)
          if (valueUSD < 0.01) continue // Skip dust

          assets.push({
            chainId: Number(chainId),
            symbol: token.symbol,
            name: token.name,
            address: token.address,
            amount: token.amount,
            amountFormatted: parseFloat(amountFormatted).toLocaleString('en-US', { maximumFractionDigits: 6 }),
            priceUSD,
            valueUSD: Math.round(valueUSD * 100) / 100,
            logoURI: token.logoURI,
            decimals: token.decimals,
          })
        }
      }

      // Sort by USD value descending
      assets.sort((a, b) => b.valueUSD - a.valueUSD)

      const totalUSD = assets.reduce((sum, a) => sum + a.valueUSD, 0)

      return {
        success: true,
        walletAddress: address,
        totalUSD: Math.round(totalUSD * 100) / 100,
        assets,
      }
    } catch (error) {
      console.error('Asset balance fetch error:', error)
      return reply.status(500).send({ error: 'Failed to fetch wallet balances' })
    }
  })

  // ================================================================
  // ENS Endpoints
  // ================================================================

  // POST /api/bots/ens/resolve - Resolve ENS name to address
  fastify.post<{ Body: { ensName: string } }>('/ens/resolve', async (request, reply) => {
    const { ensName } = request.body
    
    if (!ensName) {
      return reply.status(400).send({ error: 'ensName is required' })
    }
    
    try {
      const address = await resolveEnsName(ensName)
      
      if (!address) {
        return reply.status(404).send({ error: `Could not resolve ${ensName}` })
      }

      return {
        success: true,
        ensName,
        address,
      }
    } catch (error) {
      console.error('ENS resolution error:', error)
      return reply.status(500).send({ error: 'ENS resolution failed' })
    }
  })

  // POST /api/bots/ens/reverse - Reverse-resolve address to ENS name
  fastify.post<{ Body: { address: string } }>('/ens/reverse', async (request, reply) => {
    const { address } = request.body

    if (!address) {
      return reply.status(400).send({ error: 'address is required' })
    }

    if (!isAddress(address)) {
      return reply.status(400).send({ error: 'Invalid Ethereum address' })
    }

    try {
      const name = await reverseResolve(address)

      return {
        success: true,
        address,
        ensName: name || null,
      }
    } catch (error) {
      console.error('ENS reverse resolution error:', error)
      return reply.status(500).send({ error: 'Reverse resolution failed' })
    }
  })

  // GET /api/bots/ens/profile/:name - Get bot's full ENS profile (cached 5 min)
  fastify.get<{ Params: { name: string } }>('/ens/profile/:name', async (request, reply) => {
    const { name } = request.params
    
    try {
      const profile = await cached(
        `ens:profile:${name}`,
        300, // 5 minutes — on-chain data, rarely changes
        () => getBotProfile(name)
      )

      return {
        success: true,
        profile,
      }
    } catch (error) {
      console.error('ENS profile error:', error)
      return reply.status(500).send({ error: 'Failed to fetch ENS profile' })
    }
  })

  // GET /api/bots/ens/record/:name/:key - Read a single text record
  fastify.get<{ Params: { name: string; key: string } }>('/ens/record/:name/:key', async (request, reply) => {
    const { name, key } = request.params

    try {
      const value = await getTextRecord(name, key)

      return {
        success: true,
        ensName: name,
        key,
        value,
      }
    } catch (error) {
      console.error('ENS text record error:', error)
      return reply.status(500).send({ error: 'Failed to read text record' })
    }
  })

  // POST /api/bots/ens/records - Update text records (authenticated)
  fastify.post<{ Body: { records: Record<string, string> } }>('/ens/records', async (request, reply) => {
    const bot = await authenticateBot(request)

    if (!bot) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    if (!isEnsConfigured()) {
      return reply.status(503).send({ error: 'ENS not configured on this server' })
    }

    const { records } = request.body
    if (!records || typeof records !== 'object' || Array.isArray(records) || Object.keys(records).length === 0) {
      return reply.status(400).send({ error: 'records must be a non-empty object' })
    }

    // Limit record count, key length, and value sizes to prevent gas drain
    const MAX_RECORDS = 20
    const MAX_KEY_LENGTH = 64
    const MAX_VALUE_LENGTH = 512
    const entries = Object.entries(records)
    if (entries.length > MAX_RECORDS) {
      return reply.status(400).send({ error: `Too many records (max ${MAX_RECORDS})` })
    }
    // Reject non-string values — they would fail ABI encoding
    const nonStringKeys = entries.filter(([, v]) => typeof v !== 'string').map(([k]) => k)
    if (nonStringKeys.length > 0) {
      return reply.status(400).send({ error: `Record values must be strings: ${nonStringKeys.join(', ')}` })
    }
    const longKeys = entries.filter(([k]) => k.length > MAX_KEY_LENGTH).map(([k]) => k)
    if (longKeys.length > 0) {
      return reply.status(400).send({ error: `Record keys too long (max ${MAX_KEY_LENGTH}): ${longKeys.join(', ')}` })
    }
    const oversized = entries.filter(([, v]) => (v as string).length > MAX_VALUE_LENGTH).map(([k]) => k)
    if (oversized.length > 0) {
      return reply.status(400).send({ error: `Record values too long (max ${MAX_VALUE_LENGTH}): ${oversized.join(', ')}` })
    }

    // Only allow exact standard keys + claw2claw namespace
    const ALLOWED_STANDARD_KEYS = new Set(['description', 'avatar', 'url'])
    const invalidKeys = Object.keys(records).filter(
      key => !ALLOWED_STANDARD_KEYS.has(key) && !key.startsWith('com.claw2claw.')
    )
    if (invalidKeys.length > 0) {
      return reply.status(400).send({
        error: `Invalid record keys: ${invalidKeys.join(', ')}. Use com.claw2claw.* prefix or standard keys (description, avatar, url).`
      })
    }

    // Get ENS name from DB (cached from registration)
    const ensName = bot.ensName
    if (!ensName) {
      return reply.status(400).send({ error: 'Bot does not have an ENS name. Register with createEns: true.' })
    }

    try {
      const txHash = await setBotTextRecords(ensName, records)

      // Invalidate cached profile so next lookup reflects the updates
      await invalidate(`ens:profile:${ensName}`)

      return {
        success: true,
        ensName,
        records,
        txHash,
        explorer: `https://${getEnsConfig().network === 'mainnet' ? '' : 'sepolia.'}etherscan.io/tx/${txHash}`,
      }
    } catch (error) {
      console.error('ENS record update error:', error)
      return reply.status(500).send({ error: 'Failed to update text records' })
    }
  })

  // GET /api/bots/ens/status - Check ENS configuration status
  fastify.get('/ens/status', async () => {
    const config = getEnsConfig()
    return {
      success: true,
      ens: {
        configured: isEnsConfigured(),
        parentName: config.parentName,
        network: config.network,
        contracts: config.contracts,
      }
    }
  })
}
