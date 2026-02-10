/**
 * LI.FI SDK Service
 * Same-chain swaps + cross-chain bridges via @lifi/sdk
 * 
 * Option A: Manual sponsored execution
 * - Get quote from LI.FI (routing + calldata)
 * - Send tx via Pimlico-sponsored smartAccountClient (gasless)
 */
import {
    createConfig,
    getQuote,
    getStatus,
    type ChainId as LiFiChainId,
    type QuoteRequest,
} from '@lifi/sdk'
import crypto from 'crypto'
import { encodeFunctionData, erc20Abi, maxUint256, zeroAddress, type Hex } from 'viem'
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { prisma } from '../db.js'
import { decrypt } from '../lib/crypto.js'

import { createBlockchainClient, createSponsoredClient } from './wallet.js'



// ── SDK Initialization ──

/**
 * Initialize LI.FI SDK (call once at startup)
 */
export function initLiFi(): void {
  const integrator = process.env.LIFI_INTEGRATOR || 'claw2claw'
  const apiKey = process.env.LIFI_API_KEY || undefined

  createConfig({
    integrator,
    apiKey,
  })

  console.log(`LI.FI SDK initialized (integrator: ${integrator}, apiKey: ${apiKey ? 'set' : 'not set'})`)
}

// No EVM provider needed — we manually extract transactionRequest from quotes
// and send them through the sponsored smartAccountClient

/**
 * Decrypt bot's private key and return viem account
 */
function getBotAccount(encryptedPrivateKey: string): PrivateKeyAccount {
  const privateKey = decrypt(encryptedPrivateKey) as `0x${string}`
  return privateKeyToAccount(privateKey)
}



// ── Public API ──

export interface SwapQuoteParams {
  fromChain: number
  toChain: number
  fromToken: string
  toToken: string
  fromAmount: string
  fromAddress: string
}

export interface SwapQuoteResult {
  id: string
  fromChain: number
  toChain: number
  fromToken: { address: string; symbol: string; decimals: number }
  toToken: { address: string; symbol: string; decimals: number }
  fromAmount: string
  toAmount: string
  estimatedGas: string
  estimatedTime: number // seconds
  toolsUsed: string[]
  isCrossChain: boolean
}

/**
 * Get a swap/bridge quote from LI.FI
 */
export async function getLiFiQuote(params: SwapQuoteParams): Promise<SwapQuoteResult> {
  const quoteRequest: QuoteRequest = {
    fromChain: params.fromChain as LiFiChainId,
    toChain: params.toChain as LiFiChainId,
    fromToken: params.fromToken,
    toToken: params.toToken,
    fromAmount: params.fromAmount,
    fromAddress: params.fromAddress,
  }

  const quote = await getQuote(quoteRequest)

  return {
    id: quote.id,
    fromChain: params.fromChain,
    toChain: params.toChain,
    fromToken: {
      address: quote.action.fromToken.address,
      symbol: quote.action.fromToken.symbol,
      decimals: quote.action.fromToken.decimals,
    },
    toToken: {
      address: quote.action.toToken.address,
      symbol: quote.action.toToken.symbol,
      decimals: quote.action.toToken.decimals,
    },
    fromAmount: quote.action.fromAmount,
    toAmount: quote.estimate.toAmount,
    estimatedGas: quote.estimate.gasCosts?.[0]?.amount ?? '0',
    estimatedTime: quote.estimate.executionDuration,
    toolsUsed: [quote.toolDetails?.name ?? quote.tool].filter(Boolean),
    isCrossChain: params.fromChain !== params.toChain,
  }
}

export interface SwapExecuteParams {
  fromChain: number
  toChain: number
  fromToken: string
  toToken: string
  fromAmount: string
  encryptedPrivateKey: string
  botAddress: string
  comment?: string
}

export interface SwapExecuteResult {
  txHash: string
  dealLogId: string
  status: string
  fromAmount: string
  toAmount: string | null
}

/**
 * Execute a swap/bridge via LI.FI (gas sponsored by Pimlico)
 * 
 * Option A: Manual execution
 * 1. Get quote from LI.FI → extract transactionRequest (to, data, value)
 * 2. Handle ERC20 approval if needed (via smartAccountClient)
 * 3. Send swap tx via smartAccountClient.sendTransaction() — gasless
 */
export async function executeLiFiSwap(params: SwapExecuteParams): Promise<SwapExecuteResult> {
  const account = getBotAccount(params.encryptedPrivateKey)

  // Get fresh quote (includes transactionRequest with calldata)
  const quoteRequest: QuoteRequest = {
    fromChain: params.fromChain as LiFiChainId,
    toChain: params.toChain as LiFiChainId,
    fromToken: params.fromToken,
    toToken: params.toToken,
    fromAmount: params.fromAmount,
    fromAddress: account.address,
  }

  const quote = await getQuote(quoteRequest)

  // Extract the raw transaction data from the quote
  const txRequest = (quote as any).transactionRequest
  if (!txRequest?.to || !txRequest?.data) {
    throw new Error('LI.FI quote did not return transactionRequest — cannot execute')
  }

  // Create sponsored smart account client (Pimlico pays gas)
  const { client: smartClient, signedAuthorization } = await createSponsoredClient(params.encryptedPrivateKey, params.fromChain)

  console.log(`[executeLiFiSwap] EOA account address: ${account.address}`)
  console.log(`[executeLiFiSwap] Bot address from params: ${params.botAddress}`)
  console.log(`[executeLiFiSwap] TX target: ${txRequest.to}`)
  console.log(`[executeLiFiSwap] TX data length: ${txRequest.data?.length || 0}`)

  // Create pending deal log (use UUID to avoid timestamp collision under concurrent requests)
  const dealLog = await prisma.dealLog.create({
    data: {
      txHash: `pending-${crypto.randomUUID()}`,
      regime: params.fromChain === params.toChain ? 'lifi-swap' : 'lifi-bridge',
      chainId: params.fromChain,
      fromToken: quote.action.fromToken.symbol,
      toToken: quote.action.toToken.symbol,
      fromAmount: params.fromAmount,
      toAmount: quote.estimate.toAmount,
      botAddress: params.botAddress,
      status: 'pending',
      makerComment: params.comment ?? null,
      metadata: {
        fromChain: params.fromChain,
        toChain: params.toChain,
        fromTokenAddress: quote.action.fromToken.address,
        toTokenAddress: quote.action.toToken.address,
        fromTokenDecimals: quote.action.fromToken.decimals,
        toTokenDecimals: quote.action.toToken.decimals,
        tool: quote.tool,
        estimatedTime: quote.estimate.executionDuration,
        sponsored: true,
      },
    },
  })

   try {
    // Step 1: Handle ERC20 approval if needed (non-native tokens)
    // Use resolved token address from LI.FI quote, not raw params (which may be symbols)
    const fromTokenAddress = quote.action.fromToken.address as Hex
    const isNativeToken = fromTokenAddress === zeroAddress
    const approvalAddress = (quote.estimate as any).approvalAddress
    // Track whether the 7702 authorization has been used (it's only needed for the first tx)
    let authorizationConsumed = false

    if (!isNativeToken && approvalAddress) {
      // Check current allowance
      const publicClient = createBlockchainClient(params.fromChain)
      const allowance = await publicClient.readContract({
        address: fromTokenAddress,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [account.address, approvalAddress as Hex],
      })

      if (allowance < BigInt(params.fromAmount)) {
        console.log(`Approving ${fromTokenAddress} for ${approvalAddress} via sponsored tx (max allowance)...`)
        const approvalData = encodeFunctionData({
          abi: erc20Abi,
          functionName: 'approve',
          args: [approvalAddress as Hex, maxUint256],
        })

        const approvalTxHash = await smartClient.sendTransaction({
          to: fromTokenAddress,
          data: approvalData,
          value: 0n,
          authorization: signedAuthorization as any,
        } as any)
        authorizationConsumed = true
        console.log(`Approval tx sent: ${approvalTxHash}, waiting for confirmation...`)

        // Wait for approval to be mined before executing the swap
        await publicClient.waitForTransactionReceipt({ hash: approvalTxHash })
        console.log('Approval confirmed')
      }
    }

    // Step 2: Send the swap transaction (sponsored — Pimlico pays gas)
    // Only include authorization if it hasn't been consumed by the approval tx
    console.log(`Sending sponsored swap tx to ${txRequest.to}... (auth: ${authorizationConsumed ? 'already set' : 'included'})`)
    const swapTxParams: any = {
      to: txRequest.to as Hex,
      data: txRequest.data as Hex,
      value: txRequest.value ? BigInt(txRequest.value) : 0n,
    }
    if (!authorizationConsumed) {
      swapTxParams.authorization = signedAuthorization
    }
    const txHash = await smartClient.sendTransaction(swapTxParams)

    console.log(`Swap tx hash: ${txHash}`)

    // Update deal log with real txHash — keep status as 'pending' until confirmed
    // Callers should poll GET /:txHash/status for final confirmation
    await prisma.dealLog.update({
      where: { id: dealLog.id },
      data: {
        txHash,
        toAmount: quote.estimate.toAmount,
      },
    })

    return {
      txHash,
      dealLogId: dealLog.id,
      status: 'pending',
      fromAmount: params.fromAmount,
      toAmount: quote.estimate.toAmount,
    }
  } catch (error) {
    // Update deal log as failed
    await prisma.dealLog.update({
      where: { id: dealLog.id },
      data: {
        status: 'failed',
        metadata: {
          ...(dealLog.metadata as Record<string, unknown> ?? {}),
          error: (error as Error).message,
        },
      },
    })

    throw error
  }
}

/**
 * Get status of a cross-chain transfer
 */
export async function getSwapStatus(txHash: string, fromChain: number, toChain: number) {
  const status = await getStatus({
    txHash,
    fromChain: fromChain as LiFiChainId,
    toChain: toChain as LiFiChainId,
  })

  return {
    txHash,
    status: status.status,
    substatus: status.substatus,
    fromChain,
    toChain,
    sending: status.sending,
    receiving: 'receiving' in status ? (status as any).receiving : undefined,
  }
}

// ── Withdraw API ──

export interface WithdrawParams {
  toAddress: string
  token: string        // token contract address, or "native" for chain's native token
  amount: string       // amount in smallest unit (wei for ETH, raw decimals for ERC20)
  chainId: number
  encryptedPrivateKey: string
  botAddress: string
}

export interface WithdrawResult {
  txHash: string
  status: string
  amount: string
  toAddress: string
}

/**
 * Withdraw native token or ERC20 from the bot's AA wallet to an external address.
 *
 * Uses the same Pimlico-sponsored smartAccountClient as swaps — the bot
 * doesn't need ETH for gas, only the token being withdrawn.
 *
 * NOTE: Withdrawals are NOT logged to dealLog — they are not trades and
 * should not affect PnL statistics.
 */
export async function executeWithdraw(params: WithdrawParams): Promise<WithdrawResult> {
  const account = getBotAccount(params.encryptedPrivateKey)
  const isNativeToken = params.token.toLowerCase() === 'native' || params.token === zeroAddress

  // Create sponsored smart account client (Pimlico pays gas)
  const { client: smartClient, signedAuthorization } = await createSponsoredClient(params.encryptedPrivateKey, params.chainId)

  console.log(`[executeWithdraw] From: ${account.address}`)
  console.log(`[executeWithdraw] To: ${params.toAddress}`)
  console.log(`[executeWithdraw] Token: ${isNativeToken ? 'native' : params.token}`)
  console.log(`[executeWithdraw] Amount: ${params.amount}`)

  let txHash: string

  if (isNativeToken) {
    // Native token transfer (ETH, MATIC, AVAX, etc.)
    txHash = await smartClient.sendTransaction({
      to: params.toAddress as Hex,
      value: BigInt(params.amount),
      data: '0x' as Hex,
      authorization: signedAuthorization,
    } as any)
  } else {
    // ERC20 token transfer
    const transferData = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      args: [params.toAddress as Hex, BigInt(params.amount)],
    })

    txHash = await smartClient.sendTransaction({
      to: params.token as Hex,
      data: transferData,
      value: 0n,
      authorization: signedAuthorization,
    } as any)
  }

  console.log(`[executeWithdraw] tx hash: ${txHash}`)

  return {
    txHash,
    status: 'completed',
    amount: params.amount,
    toAddress: params.toAddress,
  }
}

