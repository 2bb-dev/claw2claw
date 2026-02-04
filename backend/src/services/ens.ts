/**
 * ENS (Ethereum Name Service) Resolution Service
 * Now integrated with Basenames for on-chain .base.eth registration
 */
import { addEnsContracts } from '@ensdomains/ensjs'
import { getAddressRecord, getTextRecord } from '@ensdomains/ensjs/public'
import { createPublicClient, http, type Address } from 'viem'
import { mainnet, sepolia } from 'viem/chains'
import {
    getBasenamesNetwork,
    isBasenamesConfigured,
    registerBasename,
    resolveBasename,
    sanitizeNameForBasename
} from './basenames.js'

// Default to mainnet for ENS (most names are on mainnet)
const ENS_CHAIN = process.env.ENS_CHAIN === 'sepolia' ? sepolia : mainnet
const ENS_RPC_URL = process.env.ENS_RPC_URL || (
  ENS_CHAIN === mainnet 
    ? 'https://eth.llamarpc.com' 
    : 'https://rpc.sepolia.org'
)

/**
 * Create ENS-enabled client
 */
function createEnsClient() {
  return createPublicClient({
    chain: addEnsContracts(ENS_CHAIN),
    transport: http(ENS_RPC_URL),
  })
}

/**
 * Validate ENS name format (supports .eth and .base.eth)
 */
export function isValidEnsName(name: string): boolean {
  if (!name) return false
  // Support both .eth and .base.eth names
  return /^[a-z0-9-]{3,}(\.[a-z0-9-]+)*\.eth$/i.test(name)
}

/**
 * Resolve ENS name to Ethereum address
 * Returns null if name doesn't exist or has no address record
 */
export async function resolveEnsToAddress(ensName: string): Promise<string | null> {
  if (!isValidEnsName(ensName)) return null
  
  // Check if it's a Basename (.base.eth)
  if (ensName.endsWith('.base.eth')) {
    const address = await resolveBasename(ensName)
    return address
  }
  
  // Regular ENS resolution
  try {
    const client = createEnsClient()
    const result = await getAddressRecord(client, {
      name: ensName,
      coin: 'ETH',
    })
    return result?.value ?? null
  } catch (error) {
    console.error(`Failed to resolve ENS name ${ensName}:`, error)
    return null
  }
}

/**
 * Get ENS text record (e.g., avatar, twitter, description)
 */
export async function getEnsTextRecord(
  ensName: string, 
  key: string
): Promise<string | null> {
  if (!isValidEnsName(ensName)) return null
  
  try {
    const client = createEnsClient()
    const result = await getTextRecord(client, {
      name: ensName,
      key,
    })
    return result ?? null
  } catch (error) {
    console.error(`Failed to get ENS text record ${key} for ${ensName}:`, error)
    return null
  }
}

/**
 * Get common ENS profile data
 */
export async function getEnsProfile(ensName: string): Promise<{
  address: string | null
  avatar: string | null
  twitter: string | null
  description: string | null
} | null> {
  if (!isValidEnsName(ensName)) return null
  
  try {
    const client = createEnsClient()
    
    const [address, avatar, twitter, description] = await Promise.all([
      getAddressRecord(client, { name: ensName, coin: 'ETH' }).then(r => r?.value ?? null),
      getTextRecord(client, { name: ensName, key: 'avatar' }),
      getTextRecord(client, { name: ensName, key: 'com.twitter' }),
      getTextRecord(client, { name: ensName, key: 'description' }),
    ])
    
    return { address, avatar, twitter, description }
  } catch (error) {
    console.error(`Failed to get ENS profile for ${ensName}:`, error)
    return null
  }
}

/**
 * Generate a subdomain name for a bot (off-chain only)
 * Used as fallback when Basenames is not configured
 */
export function generateBotEnsSubdomain(botName: string): string {
  const sanitized = sanitizeNameForBasename(botName)
  return `${sanitized}.claw2claw.eth`
}

/**
 * Register an on-chain Basename for a bot
 * Returns the full .base.eth name if successful
 */
export async function registerBotBasename(
  botName: string,
  ownerAddress: Address
): Promise<{
  success: boolean
  ensName: string
  txHash?: string
  error?: string
}> {
  // If Basenames not configured, return off-chain subdomain
  if (!isBasenamesConfigured()) {
    const offChainName = generateBotEnsSubdomain(botName)
    return {
      success: true,
      ensName: offChainName,
      error: 'Basenames not configured - using off-chain name',
    }
  }
  
  // Register on-chain Basename
  const result = await registerBasename(botName, ownerAddress, 1) // 1 year
  
  return {
    success: result.success,
    ensName: result.fullName,
    txHash: result.txHash,
    error: result.error,
  }
}

/**
 * Check if ENS is configured
 */
export function isEnsConfigured(): boolean {
  return !!ENS_RPC_URL
}

/**
 * Get ENS configuration status
 */
export function getEnsStatus(): {
  ensConfigured: boolean
  basenamesConfigured: boolean
  basenamesNetwork: string
} {
  const networkInfo = getBasenamesNetwork()
  return {
    ensConfigured: isEnsConfigured(),
    basenamesConfigured: isBasenamesConfigured(),
    basenamesNetwork: networkInfo.network,
  }
}

