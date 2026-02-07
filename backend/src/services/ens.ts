/**
 * ENS Service — Direct contract calls via viem
 * 
 * Creates bot subdomains (botname.claw2claw.eth) and manages DeFi text records
 * by calling ENS NameWrapper + PublicResolver contracts directly.
 * 
 * Set ENS_MAINNET=true for mainnet, false/unset for Sepolia testnet.
 */
import { createPublicClient, createWalletClient, http, namehash, type Hex, encodeFunctionData, keccak256, toBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { normalize } from 'viem/ens'
import { sepolia, mainnet } from 'viem/chains'

// ============================================================
// ENS_MAINNET toggle — switches between mainnet and Sepolia
// ============================================================

const IS_MAINNET = process.env.ENS_MAINNET === 'true'

const ENS_CHAIN = IS_MAINNET ? mainnet : sepolia

// Contract addresses differ per network
// Mainnet: https://docs.ens.domains/learn/deployments
// Sepolia: https://github.com/ensdomains/ens-contracts/tree/staging/deployments/sepolia
const ENS_CONTRACTS = IS_MAINNET
  ? {
      registry: '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e' as const,
      nameWrapper: '0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401' as const,
      publicResolver: '0xF29100983E058B709F3D539b0c765937B804AC15' as const,
    }
  : {
      registry: '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e' as const,
      nameWrapper: '0x0635513f179D50A207757E05759CbD106d7dFcE8' as const,
      publicResolver: '0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5' as const,
    }

// Parent domain — the one-time registered domain (normalized at startup)
const ENS_PARENT_NAME = normalize(process.env.ENS_PARENT_NAME || 'claw2claw.eth')

// ============================================================
// ABI fragments — sourced from ENS GitHub deployment JSON
// https://github.com/ensdomains/ens-contracts/tree/staging/deployments/sepolia
// ============================================================

const nameWrapperAbi = [
  // setSubnodeRecord(bytes32 parentNode, string label, address owner, address resolver, uint64 ttl, uint32 fuses, uint64 expiry)
  {
    inputs: [
      { internalType: 'bytes32', name: 'parentNode', type: 'bytes32' },
      { internalType: 'string', name: 'label', type: 'string' },
      { internalType: 'address', name: 'owner', type: 'address' },
      { internalType: 'address', name: 'resolver', type: 'address' },
      { internalType: 'uint64', name: 'ttl', type: 'uint64' },
      { internalType: 'uint32', name: 'fuses', type: 'uint32' },
      { internalType: 'uint64', name: 'expiry', type: 'uint64' },
    ],
    name: 'setSubnodeRecord',
    outputs: [{ internalType: 'bytes32', name: 'node', type: 'bytes32' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // setSubnodeOwner(bytes32 parentNode, string label, address owner, uint32 fuses, uint64 expiry)
  {
    inputs: [
      { internalType: 'bytes32', name: 'parentNode', type: 'bytes32' },
      { internalType: 'string', name: 'label', type: 'string' },
      { internalType: 'address', name: 'owner', type: 'address' },
      { internalType: 'uint32', name: 'fuses', type: 'uint32' },
      { internalType: 'uint64', name: 'expiry', type: 'uint64' },
    ],
    name: 'setSubnodeOwner',
    outputs: [{ internalType: 'bytes32', name: 'node', type: 'bytes32' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // ownerOf(uint256 id) → address
  {
    inputs: [{ internalType: 'uint256', name: 'id', type: 'uint256' }],
    name: 'ownerOf',
    outputs: [{ internalType: 'address', name: 'owner', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  // isWrapped(bytes32 node) → bool  (single-arg overload)
  {
    inputs: [{ internalType: 'bytes32', name: 'node', type: 'bytes32' }],
    name: 'isWrapped',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  // isWrapped(bytes32 parentNode, bytes32 labelhash) → bool  (two-arg overload)
  {
    inputs: [
      { internalType: 'bytes32', name: 'parentNode', type: 'bytes32' },
      { internalType: 'bytes32', name: 'labelhash', type: 'bytes32' },
    ],
    name: 'isWrapped',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

const publicResolverAbi = [
  // setText(bytes32 node, string key, string value)
  {
    inputs: [
      { internalType: 'bytes32', name: 'node', type: 'bytes32' },
      { internalType: 'string', name: 'key', type: 'string' },
      { internalType: 'string', name: 'value', type: 'string' },
    ],
    name: 'setText',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // text(bytes32 node, string key) → string
  {
    inputs: [
      { internalType: 'bytes32', name: 'node', type: 'bytes32' },
      { internalType: 'string', name: 'key', type: 'string' },
    ],
    name: 'text',
    outputs: [{ internalType: 'string', name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  // addr(bytes32 node) → address
  {
    inputs: [{ internalType: 'bytes32', name: 'node', type: 'bytes32' }],
    name: 'addr',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  // setAddr(bytes32 node, address a)
  {
    inputs: [
      { internalType: 'bytes32', name: 'node', type: 'bytes32' },
      { internalType: 'address', name: 'a', type: 'address' },
    ],
    name: 'setAddr',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // multicall(bytes[] data) → bytes[]
  {
    inputs: [{ internalType: 'bytes[]', name: 'data', type: 'bytes[]' }],
    name: 'multicall',
    outputs: [{ internalType: 'bytes[]', name: 'results', type: 'bytes[]' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const

// ============================================================
// Viem Clients
// ============================================================

const RPC_URL = process.env.ENS_RPC_URL
  || (IS_MAINNET ? 'https://eth.llamarpc.com' : 'https://ethereum-sepolia-rpc.publicnode.com')

/** Public client for read-only ENS calls (no gas) */
const publicClient = createPublicClient({
  chain: ENS_CHAIN,
  transport: http(RPC_URL),
})

/** 
 * Wallet client for write operations (costs gas).
 * Uses the deployer wallet that owns the parent ENS name.
 * Returns null if ENS_DEPLOYER_PRIVATE_KEY is not set.
 */
function getWalletClient() {
  const pk = process.env.ENS_DEPLOYER_PRIVATE_KEY
  if (!pk) return null
  
  const account = privateKeyToAccount(pk as Hex)
  return createWalletClient({
    account,
    chain: ENS_CHAIN,
    transport: http(RPC_URL),
  })
}

// ============================================================
// Public API
// ============================================================

/**
 * Check if ENS is configured (deployer key available)
 */
export function isEnsConfigured(): boolean {
  return !!process.env.ENS_DEPLOYER_PRIVATE_KEY
}

/**
 * Sanitize a bot name into a valid ENS label.
 * Throws if the result is empty (e.g., input is only symbols).
 */
export function sanitizeBotLabel(botName: string): string {
  const label = botName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32)

  if (!label) {
    throw new Error(`Invalid bot name '${botName}': produces empty ENS label`)
  }
  return label
}

/**
 * Get the full ENS name for a bot
 */
export function getBotEnsName(botName: string): string {
  const label = sanitizeBotLabel(botName)
  return `${label}.${ENS_PARENT_NAME}`
}

/**
 * Create a subdomain for a bot: botname.claw2claw.eth
 * 
 * Calls NameWrapper.setSubnodeRecord() on Sepolia.
 * The deployer wallet remains the owner of all subnames so it can
 * manage text records. The bot's wallet address is set as the
 * ETH addr record (resolution target), not the subname owner.
 * 
 * @param botName - Human-readable bot name (will be sanitized)
 * @param botWalletAddress - Bot's wallet address (set as addr record, NOT owner)
 * @returns Transaction hash and the full ENS name
 */
export async function createBotSubdomain(
  botName: string,
  botWalletAddress: string,
): Promise<{ ensName: string; txHash: string }> {
  const walletClient = getWalletClient()
  if (!walletClient) {
    throw new Error('ENS not configured: ENS_DEPLOYER_PRIVATE_KEY required')
  }

  const label = sanitizeBotLabel(botName)
  const fullName = `${label}.${ENS_PARENT_NAME}`
  const parentNode = namehash(ENS_PARENT_NAME)
  
  // Verify parent name is wrapped in NameWrapper (required for setSubnodeRecord)
  // The Sepolia NameWrapper uses the 2-arg overload: isWrapped(parentNode, labelhash)
  // For a .eth name like claw2claw.eth: parentNode = namehash('eth'), labelhash = keccak256('claw2claw')
  const ethNode = namehash('eth')
  const parentLabel = ENS_PARENT_NAME.replace(/\.eth$/, '')
  const parentLabelhash = keccak256(toBytes(parentLabel))
  
  const isWrapped = await publicClient.readContract({
    address: ENS_CONTRACTS.nameWrapper,
    abi: nameWrapperAbi,
    functionName: 'isWrapped',
    args: [ethNode, parentLabelhash],
  })
  if (!isWrapped) {
    throw new Error(
      `Parent name '${ENS_PARENT_NAME}' is not wrapped in NameWrapper. ` +
      `Please wrap it first at https://app.ens.domains`
    )
  }

  // Set expiry far in the future (10 years from now)
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 60 * 60)

  // Deployer stays owner of the subname so it can set/update text records.
  const txHash = await walletClient.writeContract({
    address: ENS_CONTRACTS.nameWrapper,
    abi: nameWrapperAbi,
    functionName: 'setSubnodeRecord',
    args: [
      parentNode,
      label,
      walletClient.account.address,  // deployer keeps ownership
      ENS_CONTRACTS.publicResolver,
      0n,           // ttl
      0,            // fuses (no restrictions)
      expiry,
    ],
  })

  // Wait for transaction confirmation
  await publicClient.waitForTransactionReceipt({ hash: txHash })

  // Set the bot's wallet address as the addr record for the subdomain
  await setBotAddress(fullName, botWalletAddress)

  console.log(`[ENS] Created subdomain: ${fullName} (addr: ${botWalletAddress}, tx: ${txHash})`)
  return { ensName: fullName, txHash }
}

/**
 * Set DeFi text records on a bot's ENS subdomain.
 * 
 * Uses PublicResolver.multicall() to batch all records in one transaction.
 * 
 * @param botName - Bot name (or full ENS name)
 * @param records - Key-value text records to set
 * @returns Transaction hash
 */
export async function setBotTextRecords(
  botName: string,
  records: Record<string, string>,
): Promise<string> {
  const walletClient = getWalletClient()
  if (!walletClient) {
    throw new Error('ENS not configured: ENS_DEPLOYER_PRIVATE_KEY required')
  }

  const fullName = botName.includes('.') ? botName : getBotEnsName(botName)
  const node = namehash(fullName)

  // Batch all setText calls into a single multicall transaction
  const calls = Object.entries(records).map(([key, value]) =>
    encodeFunctionData({
      abi: publicResolverAbi,
      functionName: 'setText',
      args: [node, key, value],
    })
  )

  const txHash = await walletClient.writeContract({
    address: ENS_CONTRACTS.publicResolver,
    abi: publicResolverAbi,
    functionName: 'multicall',
    args: [calls],
  })

  await publicClient.waitForTransactionReceipt({ hash: txHash })

  console.log(`[ENS] Set ${Object.keys(records).length} text records on ${fullName} (tx: ${txHash})`)
  return txHash
}

/**
 * Set the ETH address for a bot's ENS name
 */
export async function setBotAddress(
  botName: string,
  address: string,
): Promise<string> {
  const walletClient = getWalletClient()
  if (!walletClient) {
    throw new Error('ENS not configured: ENS_DEPLOYER_PRIVATE_KEY required')
  }

  const fullName = botName.includes('.') ? botName : getBotEnsName(botName)
  const node = namehash(fullName)

  const txHash = await walletClient.writeContract({
    address: ENS_CONTRACTS.publicResolver,
    abi: publicResolverAbi,
    functionName: 'setAddr',
    args: [node, address as `0x${string}`],
  })

  await publicClient.waitForTransactionReceipt({ hash: txHash })

  console.log(`[ENS] Set address for ${fullName} → ${address} (tx: ${txHash})`)
  return txHash
}

// ============================================================
// Read-Only Functions (no gas, no wallet needed)
// ============================================================

/**
 * Resolve an ENS name to an Ethereum address
 * Uses viem's built-in ENS resolution (getEnsAddress)
 */
export async function resolveEnsName(name: string): Promise<string | null> {
  try {
    const address = await publicClient.getEnsAddress({
      name: normalize(name),
    })
    return address
  } catch (error) {
    console.error(`[ENS] Failed to resolve ${name}:`, error)
    return null
  }
}

/**
 * Check if bot subdomain exists on-chain via NameWrapper ownership.
 * This is more reliable than resolution since a subdomain can exist
 * without an addr record set.
 */
export async function checkSubdomainExists(botName: string): Promise<boolean> {
  try {
    const ensName = getBotEnsName(botName)
    const node = namehash(ensName)
    const owner = await publicClient.readContract({
      address: ENS_CONTRACTS.nameWrapper,
      abi: nameWrapperAbi,
      functionName: 'ownerOf',
      args: [BigInt(node)],
    })
    return owner !== '0x0000000000000000000000000000000000000000'
  } catch {
    return false
  }
}

/**
 * Reverse-resolve an address to its primary ENS name.
 * NOTE: This only works if the address has set a primary name (reverse record).
 * For bot subnames, prefer using getBotEnsName() for deterministic derivation.
 */
export async function reverseResolve(address: string): Promise<string | null> {
  try {
    const name = await publicClient.getEnsName({
      address: address as `0x${string}`,
    })
    return name
  } catch (error) {
    console.error(`[ENS] Failed to reverse resolve ${address}:`, error)
    return null
  }
}

/**
 * Read a single text record from an ENS name
 */
export async function getTextRecord(name: string, key: string): Promise<string | null> {
  try {
    const value = await publicClient.getEnsText({
      name: normalize(name),
      key,
    })
    return value
  } catch (error) {
    console.error(`[ENS] Failed to get text record ${key} for ${name}:`, error)
    return null
  }
}

/**
 * Read multiple text records from an ENS name
 */
export async function getTextRecords(
  name: string,
  keys: string[],
): Promise<Record<string, string | null>> {
  const results: Record<string, string | null> = {}
  
  await Promise.all(
    keys.map(async (key) => {
      results[key] = await getTextRecord(name, key)
    })
  )

  return results
}

/**
 * Get a bot's full ENS profile (address + text records)
 */
export async function getBotProfile(botName: string): Promise<{
  ensName: string
  address: string | null
  records: Record<string, string | null>
}> {
  const ensName = botName.includes('.') ? botName : getBotEnsName(botName)
  
  const DEFI_RECORD_KEYS = [
    'description',
    'avatar',
    'url',
    'com.claw2claw.strategy',
    'com.claw2claw.risk',
    'com.claw2claw.pairs',
    'com.claw2claw.maxOrder',
    'com.claw2claw.active',
  ]

  const [address, records] = await Promise.all([
    resolveEnsName(ensName),
    getTextRecords(ensName, DEFI_RECORD_KEYS),
  ])

  return { ensName, address, records }
}

/**
 * Default DeFi text records for a new bot
 */
export function getDefaultBotRecords(botName: string): Record<string, string> {
  const label = sanitizeBotLabel(botName)
  return {
    'description': `${label} — autonomous P2P trading bot on Claw2Claw`,
    'com.claw2claw.strategy': 'default',
    'com.claw2claw.risk': 'medium',
    'com.claw2claw.pairs': 'CLAW/ZUG',
    'com.claw2claw.maxOrder': '1000',
    'com.claw2claw.active': 'true',
  }
}

/**
 * Export ENS config for use in /ens/status endpoint
 */
export function getEnsConfig() {
  return {
    network: IS_MAINNET ? 'mainnet' : 'sepolia',
    parentName: ENS_PARENT_NAME,
    contracts: {
      nameWrapper: ENS_CONTRACTS.nameWrapper,
      publicResolver: ENS_CONTRACTS.publicResolver,
    },
  }
}
