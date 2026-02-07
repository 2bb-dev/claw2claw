import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { authenticateBot, generateApiKey } from '../auth.js'
import { prisma } from '../db.js'
import { createBotWallet, getWalletBalance, isAAConfigured } from '../services/wallet.js'
import {
  createBotSubdomain,
  getBotProfile,
  getDefaultBotRecords,
  getEnsConfig,
  getTextRecord,
  isEnsConfigured,
  resolveEnsName,
  reverseResolve,
  setBotAddress,
  setBotTextRecords,
} from '../services/ens.js'
import { isAddress } from 'viem'

interface RegisterBody {
  name: string
  createWallet?: boolean
  createEns?: boolean  // Optional: create ENS subdomain for bot
}

export async function botsRoutes(fastify: FastifyInstance) {
  // GET /api/bots/me - Get authenticated bot's profile
  fastify.get('/me', async (request: FastifyRequest, reply: FastifyReply) => {
    const bot = await authenticateBot(request)
    
    if (!bot) {
      return reply.status(401).send({
        error: 'Unauthorized. Provide valid API key in Authorization header.'
      })
    }
    
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

    // Look up ENS profile on-chain
    // We check the DB ensName first (fast), then verify on-chain if needed
    let ensName: string | null = bot.ensName || null
    let ensProfile = null
    if (ensName) {
      try {
        ensProfile = await getBotProfile(ensName)
      } catch {
        // ENS lookup failed, continue without it
      }
    }
    
    return {
      success: true,
      bot: {
        id: bot.id,
        ensName,
        walletAddress: bot.walletAddress,
        walletBalance,
        ensProfile,
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
        }
      }
      
      // Create ENS subdomain if requested and configured
      let ensTxHash: string | null = null
      let ensName: string | null = null
      
      if (createEns && isEnsConfigured()) {
        try {
          const botWalletAddress = walletAddress || '0x0000000000000000000000000000000000000000'
          const result = await createBotSubdomain(name, botWalletAddress)
          ensName = result.ensName
          ensTxHash = result.txHash

          // Set default DeFi text records (deployer owns subname, so this works)
          const defaultRecords = getDefaultBotRecords(name)
          await setBotTextRecords(ensName, defaultRecords)

          // Set the ETH address record so name resolves to bot wallet
          if (walletAddress) {
            await setBotAddress(ensName, walletAddress)
          }

          console.log(`[ENS] Bot ${name} registered as ${ensName}`)
        } catch (error) {
          console.error('ENS subdomain creation failed:', error)
          // Don't fail registration if ENS fails — it's optional
          ensName = null
        }
      }
      
      // Store in DB — ensName is saved so we can look it up without on-chain calls
      // The on-chain state is the source of truth; DB is a fast cache.
      const bot = await prisma.botAuth.create({
        data: {
          apiKey,
          ensName,
          walletAddress,
          encryptedWalletKey,
        },
      })
      
      return {
        success: true,
        bot: {
          id: bot.id,
          apiKey: bot.apiKey,
          ensName: bot.ensName || null,
          wallet: bot.walletAddress,
        },
        ...(ensTxHash && ensName && {
          ens: {
            name: ensName,
            txHash: ensTxHash,
            records: getDefaultBotRecords(name),
            explorer: `https://sepolia.app.ens.domains/${ensName}`,
          }
        }),
        important: "SAVE YOUR API KEY! You need it for all requests.",
        ...(walletAddress && {
          walletInfo: `Your bot wallet is ready. Deposit assets to: ${walletAddress}`
        }),
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
          ensName: bot.ensName || null,
          balance: balance.toString(),
          balanceFormatted: `${(Number(balance) / 1e18).toFixed(6)} ETH`
        }
      }
    } catch (error) {
      console.error('Wallet balance fetch error:', error)
      return reply.status(500).send({ error: 'Failed to fetch wallet balance' })
    }
  })

  // ================================================================
  // ENS Endpoints — Direct ENS-specific code (for prize qualification)
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

  // GET /api/bots/ens/profile/:name - Get bot's full ENS profile
  fastify.get<{ Params: { name: string } }>('/ens/profile/:name', async (request, reply) => {
    const { name } = request.params
    
    try {
      const profile = await getBotProfile(name)

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
    if (!records || Object.keys(records).length === 0) {
      return reply.status(400).send({ error: 'records object is required' })
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

      return {
        success: true,
        ensName,
        records,
        txHash,
        explorer: `https://sepolia.etherscan.io/tx/${txHash}`,
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
