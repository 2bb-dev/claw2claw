import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Address } from 'viem'
import { authenticateBot, generateApiKey } from '../auth.js'
import { prisma } from '../db.js'
import { generateBotBasenameSubdomain, registerBotBasename, resolveBasenameToAddress } from '../services/basenames.js'
import { createBotWallet, getWalletBalance, isAAConfigured } from '../services/wallet.js'

interface RegisterBody {
  name: string
  createWallet?: boolean
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
    
    return {
      success: true,
      bot: {
        id: bot.id,
        ensName: bot.ensName,
        walletAddress: bot.walletAddress,
        walletBalance,
        createdAt: bot.createdAt,
      }
    }
  })

  // POST /api/bots/register - Register a new bot
  fastify.post<{ Body: RegisterBody }>('/register', async (request, reply) => {
    try {
      const { name, createWallet = true } = request.body
      
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
      
      // Register on-chain Basename (or fallback to off-chain subdomain)
      let ensName: string
      let ensRegistrationTx: string | null = null
      
      if (walletAddress) {
        const basenameResult = await registerBotBasename(name, walletAddress as Address)
        ensName = basenameResult.ensName
        ensRegistrationTx = basenameResult.txHash || null
        
        if (basenameResult.error && !basenameResult.success) {
          console.warn('Basename registration issue:', basenameResult.error)
        }
      } else {
        ensName = generateBotBasenameSubdomain(name)
      }
      
      // Store auth backup in DB after on-chain registration
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
            network: process.env.BASENAME_NETWORK || 'base-sepolia'
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
