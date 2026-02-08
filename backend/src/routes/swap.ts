/**
 * Swap Routes — LI.FI Same-Chain + Cross-Chain + Withdraw
 * 
 * POST /api/swap/quote    — Get quote for a swap/bridge
 * POST /api/swap/execute  — Execute the swap (requires funded wallet)
 * GET  /api/swap/:txHash/status — Check swap/bridge status
 * POST /api/swap/withdraw — Withdraw tokens to external wallet
 */
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { isAddress } from 'viem'
import { authenticateBot } from '../auth.js'
import { executeLiFiSwap, executeWithdraw, getLiFiQuote, getSwapStatus } from '../services/lifi.js'

interface QuoteBody {
  fromChain: number
  toChain: number
  fromToken: string
  toToken: string
  fromAmount: string
}

interface ExecuteBody extends QuoteBody {
  comment?: string
}

interface StatusParams {
  txHash: string
}

interface StatusQuery {
  fromChain?: string
  toChain?: string
}

interface WithdrawBody {
  toAddress: string
  token: string     // ERC20 contract address or "native"
  amount: string    // amount in smallest unit (wei / raw decimals)
  chainId: number
}

export async function swapRoutes(fastify: FastifyInstance) {
  // POST /api/swap/quote — Get LI.FI quote
  fastify.post<{ Body: QuoteBody }>('/quote', async (request: FastifyRequest<{ Body: QuoteBody }>, reply: FastifyReply) => {
    const bot = await authenticateBot(request)

    if (!bot) {
      return reply.status(401).send({
        error: 'Unauthorized. Provide valid API key in Authorization header.',
      })
    }

    const { fromChain, toChain, fromToken, toToken, fromAmount } = request.body

    if (!fromChain || !toChain || !fromToken || !toToken || !fromAmount) {
      return reply.status(400).send({
        error: 'Missing required fields: fromChain, toChain, fromToken, toToken, fromAmount',
      })
    }

    if (!bot.wallet?.encryptedWalletKey) {
      return reply.status(400).send({
        error: 'Bot has no wallet. Register with createWallet: true first.',
      })
    }

    // EIP-7702: wallet address IS the EOA — single address for everything
    const walletAddress = bot.wallet.walletAddress

    try {
      const quote = await getLiFiQuote({
        fromChain,
        toChain,
        fromToken,
        toToken,
        fromAmount,
        fromAddress: walletAddress,
      })

      return {
        success: true,
        quote,
        walletAddress,
      }
    } catch (error) {
      console.error('LI.FI quote error:', error)
      return reply.status(500).send({
        error: 'Failed to get swap quote',
        details: (error as Error).message,
      })
    }
  })

  // POST /api/swap/execute — Execute swap via LI.FI
  fastify.post<{ Body: ExecuteBody }>('/execute', async (request: FastifyRequest<{ Body: ExecuteBody }>, reply: FastifyReply) => {
    const bot = await authenticateBot(request)

    if (!bot) {
      return reply.status(401).send({
        error: 'Unauthorized. Provide valid API key in Authorization header.',
      })
    }

    const { fromChain, toChain, fromToken, toToken, fromAmount, comment } = request.body

    if (!fromChain || !toChain || !fromToken || !toToken || !fromAmount) {
      return reply.status(400).send({
        error: 'Missing required fields: fromChain, toChain, fromToken, toToken, fromAmount',
      })
    }

    if (!bot.wallet?.walletAddress || !bot.wallet?.encryptedWalletKey) {
      return reply.status(400).send({
        error: 'Bot has no wallet configured. Register with createWallet: true first.',
      })
    }

    try {
      const result = await executeLiFiSwap({
        fromChain,
        toChain,
        fromToken,
        toToken,
        fromAmount,
        encryptedPrivateKey: bot.wallet.encryptedWalletKey,
        botAddress: bot.wallet.walletAddress,
        comment,
      })

      return {
        success: true,
        swap: result,
      }
    } catch (error) {
      console.error('LI.FI swap execution error:', error)
      return reply.status(500).send({
        error: 'Swap execution failed',
        details: (error as Error).message,
      })
    }
  })

  // GET /api/swap/:txHash/status — Check swap status
  fastify.get<{ Params: StatusParams; Querystring: StatusQuery }>(
    '/:txHash/status',
    async (request: FastifyRequest<{ Params: StatusParams; Querystring: StatusQuery }>, reply: FastifyReply) => {
      const bot = await authenticateBot(request)

      if (!bot) {
        return reply.status(401).send({
          error: 'Unauthorized. Provide valid API key in Authorization header.',
        })
      }

      const { txHash } = request.params
      const fromChain = parseInt(request.query.fromChain || '0', 10)
      const toChain = parseInt(request.query.toChain || '0', 10)

      if (!txHash) {
        return reply.status(400).send({ error: 'txHash is required' })
      }

      if (!fromChain || !toChain) {
        return reply.status(400).send({
          error: 'fromChain and toChain query params are required',
        })
      }

      try {
        const status = await getSwapStatus(txHash, fromChain, toChain)

        // Sync deal status back to DB if terminal (fallback for cross-chain bridges)
        if (status.status === 'DONE' || status.status === 'FAILED') {
          await prisma!.dealLog.updateMany({
            where: { txHash },
            data: { status: status.status === 'DONE' ? 'completed' : 'failed' },
          })
        }

        return {
          success: true,
          status,
        }
      } catch (error) {
        console.error('LI.FI status check error:', error)
        return reply.status(500).send({
          error: 'Failed to check swap status',
          details: (error as Error).message,
        })
      }
    }
  )

  // POST /api/swap/withdraw — Withdraw tokens to external wallet
  fastify.post<{ Body: WithdrawBody }>('/withdraw', async (request: FastifyRequest<{ Body: WithdrawBody }>, reply: FastifyReply) => {
    const bot = await authenticateBot(request)

    if (!bot) {
      return reply.status(401).send({
        error: 'Unauthorized. Provide valid API key in Authorization header.',
      })
    }

    const { toAddress, token, amount, chainId } = request.body

    if (!toAddress || !token || !amount || !chainId) {
      return reply.status(400).send({
        error: 'Missing required fields: toAddress, token, amount, chainId',
      })
    }

    if (!isAddress(toAddress)) {
      return reply.status(400).send({
        error: 'Invalid toAddress — must be a valid Ethereum address',
      })
    }

    // Validate token is either "native" or a valid address
    if (token !== 'native' && !isAddress(token)) {
      return reply.status(400).send({
        error: 'Invalid token — must be "native" or a valid ERC20 contract address',
      })
    }

    if (!bot.wallet?.walletAddress || !bot.wallet?.encryptedWalletKey) {
      return reply.status(400).send({
        error: 'Bot has no wallet configured. Register with createWallet: true first.',
      })
    }

    try {
      const result = await executeWithdraw({
        toAddress,
        token,
        amount,
        chainId,
        encryptedPrivateKey: bot.wallet.encryptedWalletKey,
        botAddress: bot.wallet.walletAddress,
      })

      return {
        success: true,
        withdraw: result,
      }
    } catch (error) {
      console.error('Withdraw execution error:', error)
      return reply.status(500).send({
        error: 'Withdraw failed',
        details: (error as Error).message,
      })
    }
  })
}
