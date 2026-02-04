/**
 * Basenames Service - On-chain ENS registration on Base
 * Registers .base.eth names for trading bots
 */
import {
    createPublicClient,
    createWalletClient,
    encodeFunctionData,
    http,
    namehash,
    parseEther,
    type Address,
    type Hex
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia } from 'viem/chains'

// Network configuration
const BASENAME_NETWORK = process.env.BASENAME_NETWORK || 'base-sepolia'
const isMainnet = BASENAME_NETWORK === 'base'
const chain = isMainnet ? base : baseSepolia

// Contract addresses per network
const CONTRACTS = {
  'base': {
    registrarController: '0x4cCb0BB02FCABA27e82a56646E81d8c5bC4119a5' as Address,
    l2Resolver: '0xC6d566A56A1aFf6508b41f6c90ff131615583BCD' as Address,
    reverseRegistrar: '0x79ea96012eea67a83431f1701b3dff7e37f9e282' as Address,
  },
  'base-sepolia': {
    registrarController: '0x49ae3cc2e3aa768b1e5654f5d3c6002144a59581' as Address,
    l2Resolver: '0x6533C94869D28fAA8dF77cc63f9e2b2D6Cf77eBA' as Address,
    reverseRegistrar: '0x876eF94ce0773052a2f81921E70FF25a5e76841f' as Address,
  }
} as const

const contracts = CONTRACTS[isMainnet ? 'base' : 'base-sepolia']

// RPC URL for Base
const BASE_RPC_URL = isMainnet 
  ? 'https://mainnet.base.org'
  : 'https://sepolia.base.org'

// RegistrarController ABI (minimal for registration)
const REGISTRAR_CONTROLLER_ABI = [
  {
    name: 'available',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'name', type: 'string' }],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'rentPrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'duration', type: 'uint256' },
    ],
    outputs: [
      { 
        name: 'price', 
        type: 'tuple',
        components: [
          { name: 'base', type: 'uint256' },
          { name: 'premium', type: 'uint256' },
        ]
      }
    ],
  },
  {
    name: 'register',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'request', type: 'tuple', components: [
        { name: 'name', type: 'string' },
        { name: 'owner', type: 'address' },
        { name: 'duration', type: 'uint256' },
        { name: 'resolver', type: 'address' },
        { name: 'data', type: 'bytes[]' },
        { name: 'reverseRecord', type: 'bool' },
      ]},
    ],
    outputs: [],
  },
] as const

// L2Resolver ABI for setting records
const L2_RESOLVER_ABI = [
  {
    name: 'setAddr',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'addr', type: 'address' },
    ],
    outputs: [],
  },
] as const

/**
 * Create public client for Base
 */
function createBaseClient() {
  return createPublicClient({
    chain,
    transport: http(BASE_RPC_URL),
  })
}

/**
 * Create wallet client for transactions
 */
function createBaseWalletClient() {
  const funderKey = process.env.BASENAME_FUNDER_PRIVATE_KEY
  if (!funderKey) {
    throw new Error('BASENAME_FUNDER_PRIVATE_KEY not configured')
  }
  
  const account = privateKeyToAccount(funderKey as Hex)
  
  return createWalletClient({
    account,
    chain,
    transport: http(BASE_RPC_URL),
  })
}

/**
 * Check if Basenames is configured
 */
export function isBasenamesConfigured(): boolean {
  return !!process.env.BASENAME_FUNDER_PRIVATE_KEY
}

/**
 * Get current network info
 */
export function getBasenamesNetwork(): { network: string; chainId: number; isMainnet: boolean } {
  return {
    network: BASENAME_NETWORK,
    chainId: chain.id,
    isMainnet,
  }
}

/**
 * Check if a basename is available
 */
export async function isNameAvailable(name: string): Promise<boolean> {
  const client = createBaseClient()
  
  try {
    const available = await client.readContract({
      address: contracts.registrarController,
      abi: REGISTRAR_CONTROLLER_ABI,
      functionName: 'available',
      args: [name],
    })
    return available
  } catch (error) {
    console.error('Failed to check name availability:', error)
    return false
  }
}

/**
 * Get registration price for a name
 * @param name - The name (without .base.eth)
 * @param years - Duration in years
 */
export async function getRegistrationPrice(
  name: string, 
  years: number = 1
): Promise<{ base: bigint; premium: bigint; total: bigint }> {
  const client = createBaseClient()
  const duration = BigInt(years * 365 * 24 * 60 * 60) // seconds
  
  try {
    const price = await client.readContract({
      address: contracts.registrarController,
      abi: REGISTRAR_CONTROLLER_ABI,
      functionName: 'rentPrice',
      args: [name, duration],
    })
    
    return {
      base: price.base,
      premium: price.premium,
      total: price.base + price.premium,
    }
  } catch (error) {
    console.error('Failed to get registration price:', error)
    throw error
  }
}

/**
 * Sanitize bot name for Basename registration
 */
export function sanitizeNameForBasename(botName: string): string {
  return botName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32)
}

/**
 * Register a basename for a bot
 * @param botName - The bot name (will be sanitized)
 * @param ownerAddress - The address that will own the name
 * @param years - Registration duration in years
 */
export async function registerBasename(
  botName: string,
  ownerAddress: Address,
  years: number = 1
): Promise<{ 
  success: boolean
  name: string
  fullName: string
  txHash?: Hex
  error?: string 
}> {
  const name = sanitizeNameForBasename(botName)
  const fullName = `${name}.base.eth`
  const duration = BigInt(years * 365 * 24 * 60 * 60)
  
  console.log(`Registering basename: ${fullName} for ${ownerAddress}`)
  
  try {
    // Check if configured
    if (!isBasenamesConfigured()) {
      return {
        success: false,
        name,
        fullName,
        error: 'Basenames not configured - BASENAME_FUNDER_PRIVATE_KEY missing',
      }
    }
    
    // Check availability
    const available = await isNameAvailable(name)
    if (!available) {
      return {
        success: false,
        name,
        fullName,
        error: `Name "${name}" is not available`,
      }
    }
    
    // Get price
    const price = await getRegistrationPrice(name, years)
    console.log(`Registration price: ${price.total} wei`)
    
    // Prepare registration data
    const client = createBaseClient()
    const walletClient = createBaseWalletClient()
    
    // Encode the setAddr call for the resolver data
    const node = namehash(fullName)
    const setAddrData = encodeFunctionData({
      abi: L2_RESOLVER_ABI,
      functionName: 'setAddr',
      args: [node, ownerAddress],
    })
    
    // Build registration request
    const request = {
      name,
      owner: ownerAddress,
      duration,
      resolver: contracts.l2Resolver,
      data: [setAddrData],
      reverseRecord: true, // Set as primary name for the address
    }
    
    // Estimate gas and add buffer
    const gasPrice = await client.getGasPrice()
    const value = price.total + parseEther('0.0001') // Add small buffer for price fluctuation
    
    // Send registration transaction
    const txHash = await walletClient.writeContract({
      address: contracts.registrarController,
      abi: REGISTRAR_CONTROLLER_ABI,
      functionName: 'register',
      args: [request],
      value,
      gas: 500000n, // Fixed gas limit for registration
    })
    
    console.log(`Registration tx submitted: ${txHash}`)
    
    // Wait for confirmation
    const receipt = await client.waitForTransactionReceipt({ 
      hash: txHash,
      timeout: 60_000,
    })
    
    if (receipt.status === 'success') {
      console.log(`Basename ${fullName} registered successfully!`)
      return {
        success: true,
        name,
        fullName,
        txHash,
      }
    } else {
      return {
        success: false,
        name,
        fullName,
        txHash,
        error: 'Transaction reverted',
      }
    }
  } catch (error) {
    console.error('Basename registration failed:', error)
    return {
      success: false,
      name,
      fullName,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Resolve a basename to an address
 */
export async function resolveBasename(fullName: string): Promise<Address | null> {
  // For now, use the ENS resolution which works with Base names
  // via CCIP-Read cross-chain resolution
  try {
    const client = createBaseClient()
    const node = namehash(fullName)
    
    const address = await client.readContract({
      address: contracts.l2Resolver,
      abi: [
        {
          name: 'addr',
          type: 'function',
          stateMutability: 'view',
          inputs: [{ name: 'node', type: 'bytes32' }],
          outputs: [{ type: 'address' }],
        },
      ],
      functionName: 'addr',
      args: [node],
    })
    
    return address as Address
  } catch (error) {
    console.error(`Failed to resolve ${fullName}:`, error)
    return null
  }
}
