/**
 * P2P Trading Service — Claw2ClawHook Integration
 *
 * On-chain P2P order matching via the Claw2ClawHook (Uniswap v4).
 * Uses the same Pimlico-sponsored AA pattern as LI.FI swaps.
 *
 * Supports multiple token pairs — any two tokens can form a pool.
 *
 * Flow:
 *  1. Bot posts order → tokens escrowed in hook
 *  2. Another bot swaps via SimpleSwapRouter → hook matches P2P
 *  3. No match → swap falls through to Uniswap v4 AMM
 */
import { createWalletClient, encodeFunctionData, erc20Abi, http, maxUint256, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base } from 'viem/chains'
import { CHAIN_IDS, getRpcUrl } from '../config/chains.js'
import { prisma } from '../db.js'
import { cached } from './cache.js'
import { createBlockchainClient, createSponsoredClient } from './wallet.js'

// ── Contract Addresses (Base Mainnet) ──

const HOOK_ADDRESS = (process.env.HOOK_ADDRESS || '0x9114Ff08A837d0F8F9db23234Bf99794131FC188') as Hex
const SWAP_ROUTER_ADDRESS = (process.env.SWAP_ROUTER_ADDRESS || '0xe5b4A4dF8387858852B861B36AB5B512d7838346') as Hex
const POOL_MANAGER = (process.env.POOL_MANAGER_ADDRESS || '0x498581fF718922c3f8e6A244956aF099B2652b2b') as Hex

// ── Token Registry (Base Mainnet) ──
// Extensible list of known tokens. Add more here to support new pairs.

export interface TokenInfo {
  address: Hex
  symbol: string
  name: string
  decimals: number
}

const KNOWN_TOKENS: Record<string, TokenInfo> = {
  WETH: {
    address: '0x4200000000000000000000000000000000000006',
    symbol: 'WETH',
    name: 'Wrapped Ether',
    decimals: 18,
  },
  USDC: {
    address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
  },
  USDBC: {
    address: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6Ca',
    symbol: 'USDbC',
    name: 'USD Base Coin (Bridged)',
    decimals: 6,
  },
  DAI: {
    address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
    symbol: 'DAI',
    name: 'Dai Stablecoin',
    decimals: 18,
  },
  CBBTC: {
    address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
    symbol: 'cbBTC',
    name: 'Coinbase Wrapped BTC',
    decimals: 8,
  },
  CBETH: {
    address: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22',
    symbol: 'cbETH',
    name: 'Coinbase Wrapped Staked ETH',
    decimals: 18,
  },
  AERO: {
    address: '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
    symbol: 'AERO',
    name: 'Aerodrome',
    decimals: 18,
  },
  DEGEN: {
    address: '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed',
    symbol: 'DEGEN',
    name: 'Degen',
    decimals: 18,
  },
}

// Allow lookup by address (lowercase) as well
const TOKEN_BY_ADDRESS: Record<string, TokenInfo> = {}
for (const token of Object.values(KNOWN_TOKENS)) {
  TOKEN_BY_ADDRESS[token.address.toLowerCase()] = token
}

// Default fee and tick spacing for new pools
const DEFAULT_FEE = 3000
const DEFAULT_TICK_SPACING = 60
// 1:1 sqrtPriceX96 for equal-value tokens (adjusted per pair as needed)
const DEFAULT_SQRT_PRICE_X96 = 79228162514264337593543950336n

// Tick math constants for price limits (add +1/-1 to avoid TickMath boundary revert)
const MIN_SQRT_PRICE_X96 = 4295128740n + 1n
const MAX_SQRT_PRICE_X96 = 1461446703485210103287273052203988822378723970341n - 1n

// ── Pool Key Helpers ──

export interface PoolKeyData {
  currency0: Hex
  currency1: Hex
  fee: number
  tickSpacing: number
  hooks: Hex
}

/**
 * Compute a pool key from two token addresses.
 * Tokens are sorted by address (required by Uniswap v4).
 */
export function computePoolKey(
  tokenA: Hex,
  tokenB: Hex,
  fee: number = DEFAULT_FEE,
  tickSpacing: number = DEFAULT_TICK_SPACING,
): PoolKeyData {
  const [currency0, currency1] = tokenA.toLowerCase() < tokenB.toLowerCase()
    ? [tokenA, tokenB]
    : [tokenB, tokenA]

  return {
    currency0: currency0 as Hex,
    currency1: currency1 as Hex,
    fee,
    tickSpacing,
    hooks: HOOK_ADDRESS,
  }
}

/**
 * Resolve a token by symbol or address. Case-insensitive.
 */
export function resolveToken(symbolOrAddress: string): TokenInfo {
  // Try symbol first
  const upper = symbolOrAddress.toUpperCase()
  if (KNOWN_TOKENS[upper]) return KNOWN_TOKENS[upper]

  // Try address
  const lower = symbolOrAddress.toLowerCase()
  if (TOKEN_BY_ADDRESS[lower]) return TOKEN_BY_ADDRESS[lower]

  throw new Error(
    `Unknown token: ${symbolOrAddress}. Use a known symbol (${Object.keys(KNOWN_TOKENS).join(', ')}) or add it via POST /api/orders/tokens`
  )
}

/**
 * Determine if a token is token0 in a pool key.
 */
function isToken0(tokenAddress: Hex, poolKey: PoolKeyData): boolean {
  return tokenAddress.toLowerCase() === poolKey.currency0.toLowerCase()
}

// ── Minimal ABIs ──

const HOOK_ABI = [
  // Write functions
  {
    name: 'postOrder',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'key', type: 'tuple', components: [
        { name: 'currency0', type: 'address' },
        { name: 'currency1', type: 'address' },
        { name: 'fee', type: 'uint24' },
        { name: 'tickSpacing', type: 'int24' },
        { name: 'hooks', type: 'address' },
      ]},
      { name: 'sellToken0', type: 'bool' },
      { name: 'amountIn', type: 'uint128' },
      { name: 'minAmountOut', type: 'uint128' },
      { name: 'duration', type: 'uint256' },
    ],
    outputs: [{ name: 'orderId', type: 'uint256' }],
  },
  {
    name: 'cancelOrder',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'orderId', type: 'uint256' },
      { name: 'key', type: 'tuple', components: [
        { name: 'currency0', type: 'address' },
        { name: 'currency1', type: 'address' },
        { name: 'fee', type: 'uint24' },
        { name: 'tickSpacing', type: 'int24' },
        { name: 'hooks', type: 'address' },
      ]},
    ],
    outputs: [],
  },
  // Read functions
  {
    name: 'getPoolOrders',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'key', type: 'tuple', components: [
        { name: 'currency0', type: 'address' },
        { name: 'currency1', type: 'address' },
        { name: 'fee', type: 'uint24' },
        { name: 'tickSpacing', type: 'int24' },
        { name: 'hooks', type: 'address' },
      ]},
    ],
    outputs: [{ name: '', type: 'uint256[]' }],
  },
  {
    name: 'orders',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'orderId', type: 'uint256' }],
    outputs: [
      { name: 'maker', type: 'address' },
      { name: 'sellToken0', type: 'bool' },
      { name: 'amountIn', type: 'uint128' },
      { name: 'minAmountOut', type: 'uint128' },
      { name: 'expiry', type: 'uint256' },
      { name: 'active', type: 'bool' },
      { name: 'poolId', type: 'bytes32' },
    ],
  },
  {
    name: 'allowedBots',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'bot', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'addBot',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'bot', type: 'address' }],
    outputs: [],
  },
  {
    name: 'nextOrderId',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

const ROUTER_ABI = [
  {
    name: 'swap',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'key', type: 'tuple', components: [
        { name: 'currency0', type: 'address' },
        { name: 'currency1', type: 'address' },
        { name: 'fee', type: 'uint24' },
        { name: 'tickSpacing', type: 'int24' },
        { name: 'hooks', type: 'address' },
      ]},
      { name: 'params', type: 'tuple', components: [
        { name: 'zeroForOne', type: 'bool' },
        { name: 'amountSpecified', type: 'int256' },
        { name: 'sqrtPriceLimitX96', type: 'uint160' },
      ]},
    ],
    outputs: [],
  },
] as const

const POOL_MANAGER_ABI = [
  {
    name: 'initialize',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'key', type: 'tuple', components: [
        { name: 'currency0', type: 'address' },
        { name: 'currency1', type: 'address' },
        { name: 'fee', type: 'uint24' },
        { name: 'tickSpacing', type: 'int24' },
        { name: 'hooks', type: 'address' },
      ]},
      { name: 'sqrtPriceX96', type: 'uint160' },
    ],
    outputs: [{ name: 'tick', type: 'int24' }],
  },
] as const


// ── Public API ──

export interface PostOrderParams {
  sellToken: string      // symbol or address
  sellAmount: string     // raw amount in smallest unit
  buyToken: string       // symbol or address
  minBuyAmount: string   // minimum acceptable in smallest unit
  duration: number       // seconds until expiry
  encryptedPrivateKey: string
  botAddress: string
  comment?: string
}

export interface PostOrderResult {
  orderId: number
  txHash: string
  sellToken: string
  sellAmount: string
  buyToken: string
  minBuyAmount: string
  expiry: string
  dealLogId: string
  pool: { token0: string; token1: string }
}

/**
 * Post a P2P order on-chain (approve token → postOrder on hook)
 * Gas is sponsored by Pimlico — bot only needs the sell token.
 */
export async function postP2POrder(params: PostOrderParams): Promise<PostOrderResult> {
  const sellInfo = resolveToken(params.sellToken)
  const buyInfo = resolveToken(params.buyToken)

  if (sellInfo.address.toLowerCase() === buyInfo.address.toLowerCase()) {
    throw new Error('sellToken and buyToken must be different')
  }

  const poolKey = computePoolKey(sellInfo.address, buyInfo.address)
  const sellToken0 = isToken0(sellInfo.address, poolKey)
  const sellAmount = BigInt(params.sellAmount)
  const minBuyAmount = BigInt(params.minBuyAmount)

  // Ensure bot is whitelisted on the hook
  await ensureWhitelisted(params.botAddress)

  // Create sponsored AA client (Pimlico pays gas)
  const { client: smartClient, signedAuthorization } = await createSponsoredClient(
    params.encryptedPrivateKey, CHAIN_IDS.BASE
  )

  let authorizationConsumed = false

  // Step 1: Approve hook to spend sell token
  const publicClient = createBlockchainClient(CHAIN_IDS.BASE)
  const allowance = await publicClient.readContract({
    address: sellInfo.address,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [params.botAddress as Hex, HOOK_ADDRESS],
  })

  if (allowance < sellAmount) {
    console.log(`[P2P] Approving ${sellInfo.symbol} for hook (max allowance)...`)
    const approvalData = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'approve',
      args: [HOOK_ADDRESS, maxUint256],
    })

    const approvalTxHash = await smartClient.sendTransaction({
      to: sellInfo.address,
      data: approvalData,
      value: 0n,
      authorization: signedAuthorization as any,
    } as any)
    authorizationConsumed = true
    console.log(`[P2P] Approval tx sent: ${approvalTxHash}, waiting for confirmation...`)

    // Wait for approval to be mined before posting order
    await publicClient.waitForTransactionReceipt({ hash: approvalTxHash })
    console.log('[P2P] Approval confirmed')
  }

  // Step 2: Post order on hook
  const postOrderData = encodeFunctionData({
    abi: HOOK_ABI,
    functionName: 'postOrder',
    args: [
      poolKey,
      sellToken0,
      sellAmount,
      minBuyAmount,
      BigInt(params.duration),
    ],
  })

  const txParams: any = {
    to: HOOK_ADDRESS,
    data: postOrderData,
    value: 0n,
  }
  if (!authorizationConsumed) {
    txParams.authorization = signedAuthorization
  }

  console.log(`[P2P] Posting order: sell ${params.sellAmount} ${sellInfo.symbol} for min ${params.minBuyAmount} ${buyInfo.symbol}`)
  const txHash = await smartClient.sendTransaction(txParams)
  console.log(`[P2P] Order posted, tx: ${txHash}`)

  // Read the orderId from the contract (nextOrderId - 1 after posting)
  const nextOrderId = await publicClient.readContract({
    address: HOOK_ADDRESS,
    abi: HOOK_ABI,
    functionName: 'nextOrderId',
  })
  const orderId = Number(nextOrderId) - 1

  // Calculate expiry
  const block = await publicClient.getBlock()
  const expiryTimestamp = Number(block.timestamp) + params.duration

  // Log to DB
  const dealLog = await prisma.dealLog.create({
    data: {
      txHash,
      regime: 'p2p-post',
      chainId: CHAIN_IDS.BASE,
      fromToken: sellInfo.symbol,
      toToken: buyInfo.symbol,
      fromAmount: params.sellAmount,
      toAmount: null,
      botAddress: params.botAddress,
      status: 'pending',
      makerComment: params.comment ?? null,
      metadata: {
        orderId,
        sellToken0,
        minBuyAmount: params.minBuyAmount,
        duration: params.duration,
        hookAddress: HOOK_ADDRESS,
        sponsored: true,
        fromTokenDecimals: sellInfo.decimals,
        toTokenDecimals: buyInfo.decimals,
        pool: { token0: poolKey.currency0, token1: poolKey.currency1 },
      },
    },
  })

  // Save to P2POrder model
  await prisma.p2POrder.create({
    data: {
      onChainId: orderId,
      maker: params.botAddress,
      sellToken0,
      amountIn: params.sellAmount,
      minAmountOut: params.minBuyAmount,
      expiry: new Date(expiryTimestamp * 1000),
      status: 'active',
      txHash,
      poolKey: poolKey as any,
    },
  })

  return {
    orderId,
    txHash,
    sellToken: sellInfo.symbol,
    sellAmount: params.sellAmount,
    buyToken: buyInfo.symbol,
    minBuyAmount: params.minBuyAmount,
    expiry: new Date(expiryTimestamp * 1000).toISOString(),
    dealLogId: dealLog.id,
    pool: {
      token0: TOKEN_BY_ADDRESS[poolKey.currency0.toLowerCase()]?.symbol || poolKey.currency0,
      token1: TOKEN_BY_ADDRESS[poolKey.currency1.toLowerCase()]?.symbol || poolKey.currency1,
    },
  }
}

export interface CancelOrderParams {
  orderId: number
  sellToken: string   // needed to reconstruct pool key
  buyToken: string
  encryptedPrivateKey: string
  botAddress: string
}

/**
 * Cancel a P2P order on-chain (refund escrowed tokens)
 */
export async function cancelP2POrder(params: CancelOrderParams): Promise<{ txHash: string }> {
  const sellInfo = resolveToken(params.sellToken)
  const buyInfo = resolveToken(params.buyToken)
  const poolKey = computePoolKey(sellInfo.address, buyInfo.address)

  const { client: smartClient, signedAuthorization } = await createSponsoredClient(
    params.encryptedPrivateKey, CHAIN_IDS.BASE
  )

  const cancelData = encodeFunctionData({
    abi: HOOK_ABI,
    functionName: 'cancelOrder',
    args: [BigInt(params.orderId), poolKey],
  })

  console.log(`[P2P] Cancelling order #${params.orderId}`)
  const txHash = await smartClient.sendTransaction({
    to: HOOK_ADDRESS,
    data: cancelData,
    value: 0n,
    authorization: signedAuthorization as any,
  } as any)

  console.log(`[P2P] Order cancelled, tx: ${txHash}`)

  // Update local DB
  await prisma.p2POrder.updateMany({
    where: { onChainId: params.orderId },
    data: { status: 'cancelled' },
  })

  return { txHash }
}

export interface MatchOrderParams {
  /** Token the taker is selling */
  payToken: string
  /** Token the taker wants to receive */
  receiveToken: string
  /** Raw amount of payToken (exact input) */
  payAmount: string
  encryptedPrivateKey: string
  botAddress: string
  comment?: string
}

export interface MatchOrderResult {
  txHash: string
  dealLogId: string
  payToken: string
  receiveToken: string
  payAmount: string
  pool: { token0: string; token1: string }
}

/**
 * Execute a swap through the SimpleSwapRouter (triggers P2P matching in hook).
 * The hook's beforeSwap will match against active orders.
 */
export async function executeP2PSwap(params: MatchOrderParams): Promise<MatchOrderResult> {
  const payInfo = resolveToken(params.payToken)
  const receiveInfo = resolveToken(params.receiveToken)

  if (payInfo.address.toLowerCase() === receiveInfo.address.toLowerCase()) {
    throw new Error('payToken and receiveToken must be different')
  }

  const poolKey = computePoolKey(payInfo.address, receiveInfo.address)
  const payAmount = BigInt(params.payAmount)

  // Ensure bot is whitelisted
  await ensureWhitelisted(params.botAddress)

  // Also ensure the router is whitelisted (it's the msg.sender in beforeSwap)
  await ensureWhitelisted(SWAP_ROUTER_ADDRESS)

  const { client: smartClient, signedAuthorization } = await createSponsoredClient(
    params.encryptedPrivateKey, CHAIN_IDS.BASE
  )

  let authorizationConsumed = false

  // Step 1: Approve router to spend pay token
  const publicClient = createBlockchainClient(CHAIN_IDS.BASE)
  const allowance = await publicClient.readContract({
    address: payInfo.address,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [params.botAddress as Hex, SWAP_ROUTER_ADDRESS],
  })

  if (allowance < payAmount) {
    console.log(`[P2P] Approving ${payInfo.symbol} for router (max allowance)...`)
    const approvalData = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'approve',
      args: [SWAP_ROUTER_ADDRESS, maxUint256],
    })

    const approvalTxHash = await smartClient.sendTransaction({
      to: payInfo.address,
      data: approvalData,
      value: 0n,
      authorization: signedAuthorization as any,
    } as any)
    authorizationConsumed = true
    console.log(`[P2P] Approval tx sent: ${approvalTxHash}, waiting for confirmation...`)

    // Wait for approval to be mined before swapping
    await publicClient.waitForTransactionReceipt({ hash: approvalTxHash })
    console.log('[P2P] Approval confirmed')
  }

  // Step 2: Swap via router (triggers beforeSwap → P2P matching)
  // zeroForOne = true means selling token0 for token1
  const zeroForOne = isToken0(payInfo.address, poolKey)
  const sqrtPriceLimitX96 = zeroForOne ? MIN_SQRT_PRICE_X96 : MAX_SQRT_PRICE_X96

  const swapData = encodeFunctionData({
    abi: ROUTER_ABI,
    functionName: 'swap',
    args: [
      poolKey,
      {
        zeroForOne,
        amountSpecified: -payAmount, // negative = exact input
        sqrtPriceLimitX96,
      },
    ],
  })

  const txParams: any = {
    to: SWAP_ROUTER_ADDRESS,
    data: swapData,
    value: 0n,
  }
  if (!authorizationConsumed) {
    txParams.authorization = signedAuthorization
  }

  console.log(`[P2P] Swapping ${params.payAmount} ${payInfo.symbol} for ${receiveInfo.symbol} via router`)
  const txHash = await smartClient.sendTransaction(txParams)
  console.log(`[P2P] Swap executed, tx: ${txHash}`)

  // Wait for receipt and extract actual output amount from ERC20 Transfer events
  let actualToAmount: string | null = null
  try {
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
    // ERC20 Transfer event: Transfer(address from, address to, uint256 value)
    const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
    const botAddrLower = params.botAddress.toLowerCase().replace('0x', '').padStart(64, '0')

    for (const log of receipt.logs) {
      // Match: Transfer of receiveToken TO the bot address
      if (
        log.address.toLowerCase() === receiveInfo.address.toLowerCase() &&
        log.topics[0] === TRANSFER_TOPIC &&
        log.topics[2]?.toLowerCase() === `0x${botAddrLower}`
      ) {
        actualToAmount = BigInt(log.data).toString()
        console.log(`[P2P] Extracted toAmount from receipt: ${actualToAmount} ${receiveInfo.symbol}`)
        break
      }
    }
  } catch (err) {
    console.error('[P2P] Failed to extract toAmount from receipt:', err)
  }

  // Log deal
  const dealLog = await prisma.dealLog.create({
    data: {
      txHash,
      regime: 'p2p',
      chainId: CHAIN_IDS.BASE,
      fromToken: payInfo.symbol,
      toToken: receiveInfo.symbol,
      fromAmount: params.payAmount,
      toAmount: actualToAmount,
      botAddress: params.botAddress,
      status: 'completed',
      takerComment: params.comment ?? null,
      metadata: {
        hookAddress: HOOK_ADDRESS,
        routerAddress: SWAP_ROUTER_ADDRESS,
        zeroForOne,
        sponsored: true,
        fromTokenDecimals: payInfo.decimals,
        toTokenDecimals: receiveInfo.decimals,
        pool: { token0: poolKey.currency0, token1: poolKey.currency1 },
      },
    },
  })

  return {
    txHash,
    dealLogId: dealLog.id,
    payToken: payInfo.symbol,
    receiveToken: receiveInfo.symbol,
    payAmount: params.payAmount,
    pool: {
      token0: TOKEN_BY_ADDRESS[poolKey.currency0.toLowerCase()]?.symbol || poolKey.currency0,
      token1: TOKEN_BY_ADDRESS[poolKey.currency1.toLowerCase()]?.symbol || poolKey.currency1,
    },
  }
}

export interface OnChainOrder {
  orderId: number
  maker: string
  sellToken0: boolean
  sellToken: string
  buyToken: string
  amountIn: string
  minAmountOut: string
  expiry: string
  active: boolean
  isExpired: boolean
  sellTokenDecimals: number
  buyTokenDecimals: number
}

/**
 * Read active orders from the hook contract for a specific pool (gas-free, read-only).
 * If no tokens specified, uses WETH/USDC as default.
 */
export async function getActiveOrders(tokenA: string, tokenB: string): Promise<OnChainOrder[]> {
  const symA = tokenA.toUpperCase()
  const symB = tokenB.toUpperCase()
  const cacheKey = `p2p:orders:${symA}:${symB}`

  return cached(cacheKey, 10, async () => {
    const infoA = resolveToken(symA)
    const infoB = resolveToken(symB)
    const poolKey = computePoolKey(infoA.address, infoB.address)

    const token0Info = TOKEN_BY_ADDRESS[poolKey.currency0.toLowerCase()]
    const token1Info = TOKEN_BY_ADDRESS[poolKey.currency1.toLowerCase()]
    const token0Symbol = token0Info?.symbol || poolKey.currency0
    const token1Symbol = token1Info?.symbol || poolKey.currency1
    const token0Decimals = token0Info?.decimals ?? 18
    const token1Decimals = token1Info?.decimals ?? 18

    const publicClient = createBlockchainClient(CHAIN_IDS.BASE)

    // Get all order IDs for this pool
    const orderIds = await publicClient.readContract({
      address: HOOK_ADDRESS,
      abi: HOOK_ABI,
      functionName: 'getPoolOrders',
      args: [poolKey],
    }) as bigint[]

    if (orderIds.length === 0) return []

    const now = Math.floor(Date.now() / 1000)

    // Fetch all order details in parallel instead of sequential loop
    const orderResults = await Promise.all(
      orderIds.map(async (id) => {
        const [maker, sellToken0, amountIn, minAmountOut, expiry, active, _poolId] = await publicClient.readContract({
          address: HOOK_ADDRESS,
          abi: HOOK_ABI,
          functionName: 'orders',
          args: [id],
        }) as [string, boolean, bigint, bigint, bigint, boolean, string]

        const isExpired = Number(expiry) < now

        return {
          orderId: Number(id),
          maker,
          sellToken0,
          sellToken: sellToken0 ? token0Symbol : token1Symbol,
          buyToken: sellToken0 ? token1Symbol : token0Symbol,
          amountIn: amountIn.toString(),
          minAmountOut: minAmountOut.toString(),
          expiry: new Date(Number(expiry) * 1000).toISOString(),
          active,
          isExpired,
          sellTokenDecimals: sellToken0 ? token0Decimals : token1Decimals,
          buyTokenDecimals: sellToken0 ? token1Decimals : token0Decimals,
        } as OnChainOrder
      })
    )

    // Sort by orderId descending for consistent display
    return orderResults.sort((a, b) => b.orderId - a.orderId)
  })
}

/**
 * Read active orders from ALL pools that have P2POrders.
 * Discovers pools from DB records, then queries each on-chain.
 */
export async function getAllActiveOrders(): Promise<OnChainOrder[]> {
  return cached('p2p:orders:all', 10, async () => {
    // Get distinct pool pairs from DB
    const dbOrders = await prisma.p2POrder.findMany({
      where: { status: 'active' },
      select: { poolKey: true },
    })

    // Extract unique token pairs from poolKey JSON
    const poolPairs = new Map<string, { tokenA: string; tokenB: string }>()
    for (const o of dbOrders) {
      const pk = o.poolKey as Record<string, string>
      if (pk?.currency0 && pk?.currency1) {
        const key = `${pk.currency0.toLowerCase()}-${pk.currency1.toLowerCase()}`
        if (!poolPairs.has(key)) {
          const t0 = TOKEN_BY_ADDRESS[pk.currency0.toLowerCase()]
          const t1 = TOKEN_BY_ADDRESS[pk.currency1.toLowerCase()]
          if (t0 && t1) {
            poolPairs.set(key, { tokenA: t0.symbol, tokenB: t1.symbol })
          }
        }
      }
    }

    // Query all pools in parallel (each pool call is itself cached)
    const poolResults = await Promise.all(
      [...poolPairs.values()].map(async ({ tokenA, tokenB }) => {
        try {
          return await getActiveOrders(tokenA, tokenB)
        } catch (err) {
          console.warn(`[getAllActiveOrders] Failed to query pool ${tokenA}/${tokenB}:`, err)
          return []
        }
      })
    )

    // Deduplicate and sort by orderId descending
    const seenOrderIds = new Set<number>()
    const allOrders: OnChainOrder[] = []
    for (const orders of poolResults) {
      for (const order of orders) {
        if (!seenOrderIds.has(order.orderId)) {
          seenOrderIds.add(order.orderId)
          allOrders.push(order)
        }
      }
    }

    return allOrders.sort((a, b) => b.orderId - a.orderId)
  })
}


// ── Pool Initialization ──

export interface InitPoolResult {
  txHash: string
  poolKey: PoolKeyData
  token0: string
  token1: string
  sqrtPriceX96: string
}

/**
 * Initialize a new Uniswap v4 pool with our hook attached.
 * Uses the admin key (same as for whitelisting).
 * Anyone can call poolManager.initialize — it's permissionless on-chain,
 * but we gate it behind the admin key for consistency.
 */
export async function initializePool(
  tokenASymbol: string,
  tokenBSymbol: string,
  sqrtPriceX96?: string,
): Promise<InitPoolResult> {
  const adminKey = process.env.HOOK_ADMIN_PRIVATE_KEY
  if (!adminKey) throw new Error('HOOK_ADMIN_PRIVATE_KEY required to initialize pools')

  const tokenA = resolveToken(tokenASymbol)
  const tokenB = resolveToken(tokenBSymbol)

  if (tokenA.address.toLowerCase() === tokenB.address.toLowerCase()) {
    throw new Error('Cannot create pool with same token')
  }

  const poolKey = computePoolKey(tokenA.address, tokenB.address)

  // Use provided sqrtPriceX96 or default 1:1
  const price = sqrtPriceX96 ? BigInt(sqrtPriceX96) : DEFAULT_SQRT_PRICE_X96

  const admin = privateKeyToAccount(adminKey as Hex)
  const walletClient = createWalletClient({
    account: admin,
    chain: base,
    transport: http(getRpcUrl(CHAIN_IDS.BASE)),
  })

  const initData = encodeFunctionData({
    abi: POOL_MANAGER_ABI,
    functionName: 'initialize',
    args: [poolKey, price],
  })

  console.log(`[P2P] Initializing pool: ${tokenA.symbol}/${tokenB.symbol}`)
  const txHash = await walletClient.sendTransaction({
    to: POOL_MANAGER,
    data: initData,
    value: 0n,
  })

  const token0Info = TOKEN_BY_ADDRESS[poolKey.currency0.toLowerCase()]
  const token1Info = TOKEN_BY_ADDRESS[poolKey.currency1.toLowerCase()]

  console.log(`[P2P] Pool initialized: ${token0Info?.symbol}/${token1Info?.symbol}, tx: ${txHash}`)

  return {
    txHash,
    poolKey,
    token0: token0Info?.symbol || poolKey.currency0,
    token1: token1Info?.symbol || poolKey.currency1,
    sqrtPriceX96: price.toString(),
  }
}


// ── Bot Whitelisting ──

/**
 * Check if a bot is whitelisted on the hook, auto-whitelist if not.
 * Uses the admin key from env to call addBot().
 */
export async function ensureWhitelisted(botAddress: string): Promise<void> {
  const adminKey = process.env.HOOK_ADMIN_PRIVATE_KEY
  if (!adminKey) {
    console.warn('[P2P] HOOK_ADMIN_PRIVATE_KEY not set — cannot auto-whitelist')
    return
  }

  const publicClient = createBlockchainClient(CHAIN_IDS.BASE)

  // Check if already whitelisted
  const isAllowed = await publicClient.readContract({
    address: HOOK_ADDRESS,
    abi: HOOK_ABI,
    functionName: 'allowedBots',
    args: [botAddress as Hex],
  })

  if (isAllowed) return

  // Whitelist via admin key (direct EOA tx, not sponsored)
  console.log(`[P2P] Whitelisting bot ${botAddress} on hook...`)

  const admin = privateKeyToAccount(adminKey as Hex)

  const walletClient = createWalletClient({
    account: admin,
    chain: base,
    transport: http(getRpcUrl(CHAIN_IDS.BASE)),
  })

  const addBotData = encodeFunctionData({
    abi: HOOK_ABI,
    functionName: 'addBot',
    args: [botAddress as Hex],
  })

  const txHash = await walletClient.sendTransaction({
    to: HOOK_ADDRESS,
    data: addBotData,
    value: 0n,
  })

  console.log(`[P2P] Bot whitelisted, tx: ${txHash}`)
}


// ── Token Registry Management ──

/**
 * Add a custom token to the registry at runtime.
 * Useful for tokens not in the default list.
 */
export function addToken(token: TokenInfo): void {
  const upper = token.symbol.toUpperCase()
  KNOWN_TOKENS[upper] = { ...token, symbol: upper }
  TOKEN_BY_ADDRESS[token.address.toLowerCase()] = KNOWN_TOKENS[upper]
  console.log(`[P2P] Token added: ${upper} (${token.address})`)
}

/**
 * Get all known tokens
 */
export function getKnownTokens(): TokenInfo[] {
  return Object.values(KNOWN_TOKENS)
}


// ── Configuration ──

/**
 * Check if P2P infrastructure is configured
 */
export function isP2PConfigured(): boolean {
  return !!process.env.HOOK_ADMIN_PRIVATE_KEY
}

/**
 * Get P2P contract addresses and supported tokens (for API responses)
 */
export function getP2PConfig() {
  return {
    configured: isP2PConfigured(),
    hookAddress: HOOK_ADDRESS,
    routerAddress: SWAP_ROUTER_ADDRESS,
    poolManager: POOL_MANAGER,
    chainId: CHAIN_IDS.BASE,
    defaultFee: DEFAULT_FEE,
    defaultTickSpacing: DEFAULT_TICK_SPACING,
    supportedTokens: Object.values(KNOWN_TOKENS).map(t => ({
      symbol: t.symbol,
      address: t.address,
      decimals: t.decimals,
      name: t.name,
    })),
  }
}
