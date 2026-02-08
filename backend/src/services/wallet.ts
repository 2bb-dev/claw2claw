/**
 * Account Abstraction Wallet Service (EIP-7702)
 * 
 * Uses EIP-7702 via Pimlico (permissionless.js) for smart wallets.
 * The EOA itself becomes the smart account — ONE address for everything:
 *   - LI.FI swaps (raw transaction signing)
 *   - Pimlico gas sponsorship (UserOperations with 7702 delegation)
 */
import { createSmartAccountClient } from 'permissionless'
import { to7702SimpleSmartAccount } from 'permissionless/accounts'
import { createPimlicoClient } from 'permissionless/clients/pimlico'
import { createPublicClient, formatEther, http, type Hex } from 'viem'
import { entryPoint08Address } from 'viem/account-abstraction'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import {
  CHAIN_IDS,
  DEFAULT_CHAIN_ID,
  getChainConfig,
  getPimlicoRpcUrl,
  getRpcUrl,
  getViemChain
} from '../config/chains.js'
import { decrypt, encrypt } from '../lib/crypto.js'

/**
 * Create public client for blockchain interactions
 * Uses standard chain RPC (NOT Pimlico bundler — it doesn't support eth_call)
 */
export function createBlockchainClient(chainId: number = DEFAULT_CHAIN_ID) {
  const chain = getViemChain(chainId)
  const rpcUrl = getRpcUrl(chainId)
  
  return createPublicClient({
    chain,
    transport: http(rpcUrl),
  })
}

/**
 * Create Pimlico client for bundler/paymaster operations
 * Not exported due to complex type inference - use getGasPrice() instead
 */
function createBundlerClient(chainId: number = DEFAULT_CHAIN_ID) {
  const chain = getViemChain(chainId)
  const pimlicoUrl = getPimlicoRpcUrl(chainId)
  
  return createPimlicoClient({
    chain,
    entryPoint: {
      address: entryPoint08Address,
      version: '0.8',
    },
    transport: http(pimlicoUrl),
  })
}

/**
 * Generate a new wallet for a bot.
 * 
 * EIP-7702: The wallet address IS the EOA address.
 * The same private key signs both regular transactions (LI.FI)
 * and UserOperations (Pimlico-sponsored).
 */
export async function createBotWallet(chainId: number = DEFAULT_CHAIN_ID): Promise<{
  walletAddress: string
  encryptedPrivateKey: string
  chainId: number
  privateKey: Hex  // Only returned for initial setup, not stored
}> {
  const privateKey = generatePrivateKey()
  const owner = privateKeyToAccount(privateKey)
  
  // EIP-7702: wallet address = EOA address (no counterfactual deployment)
  const walletAddress = owner.address
  
  // Encrypt private key for secure storage
  const encryptedPrivateKey = encrypt(privateKey)
  
  return {
    walletAddress,
    encryptedPrivateKey,
    chainId,
    privateKey, // Caller should not persist this!
  }
}

/**
 * Get 7702 smart account instance from stored encrypted key
 * Used for sponsored UserOperations via Pimlico bundler
 */
export async function getBotSmartAccount(encryptedPrivateKey: string, chainId: number = DEFAULT_CHAIN_ID) {
  const privateKey = decrypt(encryptedPrivateKey) as Hex
  const owner = privateKeyToAccount(privateKey)
  
  const client = createBlockchainClient(chainId)
  
  const smartAccount = await to7702SimpleSmartAccount({
    client,
    owner,
    entryPoint: {
      address: entryPoint08Address,
      version: '0.8',
    },
  })
  
  return smartAccount
}

/**
 * Pre-sign the EIP-7702 authorization for a bot's smart account.
 * 
 * WORKAROUND: viem v2.45.1 has a bug in prepareUserOperation where the
 * EIP-7702 authorization is given stub r/s/yParity values, and sendUserOperation
 * never replaces them with real signatures. We sign the authorization ourselves
 * and pass it explicitly in sendTransaction calls to bypass the stub.
 */
export async function getSignedAuthorization(encryptedPrivateKey: string, chainId: number = DEFAULT_CHAIN_ID) {
  const privateKey = decrypt(encryptedPrivateKey) as Hex
  const owner = privateKeyToAccount(privateKey)
  const client = createBlockchainClient(chainId)
  
  // Get the EOA's current transaction count (= EIP-7702 auth nonce for fresh accounts)
  const nonce = await client.getTransactionCount({ address: owner.address, blockTag: 'pending' })
  
  // The implementation address for SimpleSmartAccount (same one used by permissionless.js)
  const implementationAddress = '0xe6Cae83BdE06E4c305530e199D7217f42808555B'
  
  // Sign the authorization with the real private key
  const signedAuth = await owner.signAuthorization({
    address: implementationAddress as `0x${string}`,
    chainId,
    nonce,
  })
  
  console.log(`[getSignedAuthorization] Owner: ${owner.address}, nonce: ${nonce}, chainId: ${chainId}`)
  
  return signedAuth
}

/**
 * Get the signer (EOA) from encrypted private key
 * For direct transaction signing (LI.FI swaps, etc.)
 */
export function getBotSigner(encryptedPrivateKey: string) {
  const privateKey = decrypt(encryptedPrivateKey) as Hex
  return privateKeyToAccount(privateKey)
}

/**
 * Create a sponsored smart account client (EIP-7702 + Pimlico paymaster)
 * 
 * Returns a smartAccountClient that wraps any sendTransaction() call
 * into a UserOperation with gas sponsored by Pimlico's paymaster.
 * The bot doesn't need ETH for gas — only the swap token.
 */
export async function createSponsoredClient(encryptedPrivateKey: string, chainId: number = DEFAULT_CHAIN_ID) {
  const smartAccount = await getBotSmartAccount(encryptedPrivateKey, chainId)
  const pimlicoClient = createBundlerClient(chainId)
  const pimlicoUrl = getPimlicoRpcUrl(chainId)
  const chain = getViemChain(chainId)

  // Pre-sign the EIP-7702 authorization (workaround for viem stub signature bug)
  const signedAuthorization = await getSignedAuthorization(encryptedPrivateKey, chainId)

  console.log(`[createSponsoredClient] Smart account address: ${smartAccount.address}`)
  console.log(`[createSponsoredClient] Chain: ${chain.name} (${chainId})`)

  const client = createSmartAccountClient({
    account: smartAccount,
    chain,
    bundlerTransport: http(pimlicoUrl),
    paymaster: pimlicoClient,
    userOperation: {
      estimateFeesPerGas: async () => {
        return (await pimlicoClient.getUserOperationGasPrice()).fast
      },
    },
  })

  return { client, signedAuthorization }
}

/**
 * Get wallet balance (native token) on a specific chain
 */
export async function getWalletBalance(
  walletAddress: string, 
  chainId: number = DEFAULT_CHAIN_ID
): Promise<{
  balance: bigint
  formatted: string
  symbol: string
}> {
  const client = createBlockchainClient(chainId)
  const config = getChainConfig(chainId)
  const balance = await client.getBalance({ address: walletAddress as `0x${string}` })
  
  return {
    balance,
    formatted: formatEther(balance),
    symbol: config?.nativeCurrency || 'ETH',
  }
}

/**
 * Get wallet balances across multiple chains
 */
export async function getMultiChainBalances(
  walletAddress: string, 
  chainIds: number[] = [CHAIN_IDS.ARBITRUM, CHAIN_IDS.OPTIMISM, CHAIN_IDS.BASE]
): Promise<Record<number, { balance: bigint; formatted: string; symbol: string }>> {
  const results: Record<number, { balance: bigint; formatted: string; symbol: string }> = {}
  
  await Promise.all(
    chainIds.map(async (chainId) => {
      try {
        results[chainId] = await getWalletBalance(walletAddress, chainId)
      } catch (error) {
        console.error(`Failed to fetch balance on chain ${chainId}:`, error)
        results[chainId] = {
          balance: 0n,
          formatted: '0',
          symbol: getChainConfig(chainId)?.nativeCurrency || 'ETH',
        }
      }
    })
  )
  
  return results
}

/**
 * Check if the AA infrastructure is properly configured
 */
export function isAAConfigured(): boolean {
  return !!process.env.MASTER_SECRET
}

/**
 * Get Pimlico gas price for a chain (for gas estimation)
 */
export async function getGasPrice(chainId: number = DEFAULT_CHAIN_ID) {
  const bundler = createBundlerClient(chainId)
  const gasPrice = await bundler.getUserOperationGasPrice()
  return gasPrice.fast
}

// Re-export chain utilities for convenience
export {
  CHAIN_IDS,
  DEFAULT_CHAIN_ID,
  getChainConfig, getCrossChainSupportedIds, getMainnetChainIds, getSupportedChainIds, getTestnetChainIds, supportsAccountAbstraction
} from '../config/chains.js'

