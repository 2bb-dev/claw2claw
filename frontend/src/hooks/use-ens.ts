'use client'

/**
 * ENS Hooks — wagmi hooks for ENS name resolution and text records
 *
 * All ENS-specific code for the frontend lives here.
 */
import { useEnsName, useEnsAddress, useEnsAvatar, useEnsText } from 'wagmi'
import { normalize } from 'viem/ens'
import { ensChainId } from '@/lib/wagmi'

// ============================================================
// DeFi text record keys used by Claw2Claw bots
// ============================================================

export const ENS_RECORD_KEYS = {
  STRATEGY: 'com.claw2claw.strategy',
  RISK: 'com.claw2claw.risk',
  PAIRS: 'com.claw2claw.pairs',
  MAX_ORDER: 'com.claw2claw.maxOrder',
  ACTIVE: 'com.claw2claw.active',
  DESCRIPTION: 'description',
  AVATAR: 'avatar',
  URL: 'url',
} as const

/**
 * Safe wrapper around normalize() — returns undefined if the name is
 * invalid, so hooks can disable the query instead of crashing during render.
 */
function safeNormalize(name: string | undefined): string | undefined {
  if (!name) return undefined
  try {
    return normalize(name)
  } catch {
    return undefined
  }
}

// ============================================================
// Core ENS Hooks (wagmi)
// ============================================================

/**
 * Resolve an Ethereum address to its ENS name
 * Example: 0x1234... → "clawbot.claw2claw.eth"
 */
export function useEnsNameForAddress(address: `0x${string}` | undefined) {
  return useEnsName({
    address,
    chainId: ensChainId,
    query: { enabled: !!address },
  })
}

/**
 * Resolve an ENS name to an Ethereum address
 * Example: "clawbot.claw2claw.eth" → 0x1234...
 */
export function useEnsAddressForName(name: string | undefined) {
  const normalized = safeNormalize(name)
  return useEnsAddress({
    name: normalized,
    chainId: ensChainId,
    query: { enabled: !!normalized },
  })
}

/**
 * Get the avatar for an ENS name
 */
export function useEnsAvatarForName(name: string | undefined) {
  const normalized = safeNormalize(name)
  return useEnsAvatar({
    name: normalized,
    chainId: ensChainId,
    query: { enabled: !!normalized },
  })
}

// ============================================================
// DeFi Text Record Hooks (wagmi)
// ============================================================

/**
 * Read a single ENS text record
 */
export function useEnsRecord(name: string | undefined, key: string) {
  const normalized = safeNormalize(name)
  return useEnsText({
    name: normalized,
    key,
    chainId: ensChainId,
    query: { enabled: !!normalized },
  })
}

/**
 * Read a bot's trading strategy from ENS text records
 */
export function useBotStrategy(ensName: string | undefined) {
  return useEnsRecord(ensName, ENS_RECORD_KEYS.STRATEGY)
}

/**
 * Read a bot's risk tolerance from ENS text records
 */
export function useBotRisk(ensName: string | undefined) {
  return useEnsRecord(ensName, ENS_RECORD_KEYS.RISK)
}

/**
 * Read a bot's preferred trading pairs from ENS text records
 */
export function useBotPairs(ensName: string | undefined) {
  return useEnsRecord(ensName, ENS_RECORD_KEYS.PAIRS)
}

/**
 * Read a bot's max order size from ENS text records
 */
export function useBotMaxOrder(ensName: string | undefined) {
  return useEnsRecord(ensName, ENS_RECORD_KEYS.MAX_ORDER)
}

/**
 * Read whether a bot is actively trading
 */
export function useBotActive(ensName: string | undefined) {
  return useEnsRecord(ensName, ENS_RECORD_KEYS.ACTIVE)
}

/**
 * Read a bot's description from ENS text records
 */
export function useBotDescription(ensName: string | undefined) {
  return useEnsRecord(ensName, ENS_RECORD_KEYS.DESCRIPTION)
}

// ============================================================
// Composite Hook — full bot profile from ENS
// ============================================================

/**
 * Get a bot's complete DeFi profile from ENS text records.
 * Returns all trading preferences stored on-chain.
 */
export function useBotEnsProfile(ensName: string | undefined) {
  const address = useEnsAddressForName(ensName)
  const avatar = useEnsAvatarForName(ensName)
  const strategy = useBotStrategy(ensName)
  const risk = useBotRisk(ensName)
  const pairs = useBotPairs(ensName)
  const maxOrder = useBotMaxOrder(ensName)
  const active = useBotActive(ensName)
  const description = useBotDescription(ensName)

  const isLoading = address.isLoading || avatar.isLoading || strategy.isLoading || risk.isLoading || pairs.isLoading || maxOrder.isLoading || active.isLoading || description.isLoading

  return {
    ensName,
    address: address.data,
    avatar: avatar.data,
    strategy: strategy.data,
    risk: risk.data,
    pairs: pairs.data,
    maxOrder: maxOrder.data,
    active: active.data !== undefined ? active.data === 'true' : undefined,
    description: description.data,
    isLoading,
  }
}

// ============================================================
// Utility: Display-friendly address
// ============================================================

/**
 * Format an address for display, showing ENS name if available
 * Falls back to truncated hex address
 */
export function truncateAddress(address: string): string {
  if (address.includes('.')) return address // Already an ENS name
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}
