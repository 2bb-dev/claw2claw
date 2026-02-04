/**
 * Account Abstraction Wallet Service
 * Uses EIP-4337 via Pimlico (permissionless.js) for smart wallets
 * Supports multiple chains via centralized config
 */
import { toSimpleSmartAccount } from 'permissionless/accounts'
import { createPimlicoClient } from 'permissionless/clients/pimlico'
import { createPublicClient, formatEther, http, type Hex } from 'viem'
import { entryPoint07Address } from 'viem/account-abstraction'
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
      address: entryPoint07Address,
      version: '0.7',
    },
    transport: http(pimlicoUrl),
  })
}

/**
 * Generate a new wallet for a bot on a specific chain
 * Returns the smart wallet address and encrypted private key for storage
 */
export async function createBotWallet(chainId: number = DEFAULT_CHAIN_ID): Promise<{
  walletAddress: string
  encryptedPrivateKey: string
  chainId: number
  privateKey: Hex  // Only returned for initial setup, not stored
}> {
  const privateKey = generatePrivateKey()
  const owner = privateKeyToAccount(privateKey)
  
  const client = createBlockchainClient(chainId)
  
  // Create Simple Smart Account (EIP-4337)
  const smartAccount = await toSimpleSmartAccount({
    client,
    owner,
    entryPoint: {
      address: entryPoint07Address,
      version: '0.7',
    },
  })
  
  // Encrypt private key for secure storage
  const encryptedPrivateKey = encrypt(privateKey)
  
  return {
    walletAddress: smartAccount.address,
    encryptedPrivateKey,
    chainId,
    privateKey, // Caller should not persist this!
  }
}

/**
 * Get smart account instance from stored encrypted key
 * Used for signing transactions
 */
export async function getBotSmartAccount(encryptedPrivateKey: string, chainId: number = DEFAULT_CHAIN_ID) {
  const privateKey = decrypt(encryptedPrivateKey) as Hex
  const owner = privateKeyToAccount(privateKey)
  
  const client = createBlockchainClient(chainId)
  
  const smartAccount = await toSimpleSmartAccount({
    client,
    owner,
    entryPoint: {
      address: entryPoint07Address,
      version: '0.7',
    },
  })
  
  return smartAccount
}

/**
 * Get the signer (EOA) from encrypted private key
 * For direct transaction signing
 */
export function getBotSigner(encryptedPrivateKey: string) {
  const privateKey = decrypt(encryptedPrivateKey) as Hex
  return privateKeyToAccount(privateKey)
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

