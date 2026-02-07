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
      
      // Create ENS subdomain if requested, configured, and wallet was successfully created
      let ensTxHash: string | null = null
      let ensName: string | null = null
      let recordsTxHash: string | null = null
      
      let ensError: string | null = null
      
      if (createEns && isEnsConfigured() && walletAddress) {
        // Step 1: Create the subdomain (on-chain tx)
        try {
          const result = await createBotSubdomain(name, walletAddress)
          ensName = result.ensName
          ensTxHash = result.txHash
          console.log(`[ENS] Bot ${name} registered as ${ensName}`)
        } catch (error) {
          console.error('ENS subdomain creation failed:', error)
          ensError = error instanceof Error ? error.message : String(error)
          // Don't fail registration if ENS fails — it's optional
        }

        // Step 2: Set default text records (separate try/catch so subdomain persists)
        if (ensName) {
          try {
            const defaultRecords = getDefaultBotRecords(name)
            recordsTxHash = await setBotTextRecords(ensName, defaultRecords)
          } catch (error) {
            console.error('ENS text record setup failed:', error)
            // Subdomain exists; keep ensName/ensTxHash so it remains discoverable
          }
        }
      } else if (createEns && !isEnsConfigured()) {
        ensError = 'ENS not configured: ENS_DEPLOYER_PRIVATE_KEY is missing'
      } else if (createEns && !walletAddress) {
        ensError = 'Wallet creation failed — ENS requires a wallet address'
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
            ...(recordsTxHash && {
              records: getDefaultBotRecords(name),
              recordsTxHash,
            }),
            explorer: `https://${getEnsConfig().network === 'mainnet' ? '' : 'sepolia.'}app.ens.domains/${ensName}`,
          }
        }),
        important: "SAVE YOUR API KEY! You need it for all requests.",
        ...(walletAddress && {
          walletInfo: `Your bot wallet is ready. Deposit assets to: ${walletAddress}`
        }),
        ...(ensError && { ensError }),
        ...(walletError && { walletError }),
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
