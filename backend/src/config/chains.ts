/**
 * Multi-Chain Configuration
 * 
 * Centralized chain configuration for:
 * - Pimlico (AA bundler/paymaster)
 * - LI.FI (cross-chain swaps)
 * - ENS (name resolution)
 * - General RPC access
 * 
 * Pimlico URL pattern: https://api.pimlico.io/v2/{chainId}/rpc?apikey={apiKey}
 * Public endpoint: https://public.pimlico.io/v2/{chainId}/rpc (rate limited)
 */

import { arbitrum, avalanche, base, baseSepolia, bsc, Chain, mainnet, optimism, polygon, sepolia } from 'viem/chains'

// Chain IDs for reference
export const CHAIN_IDS = {
  ETHEREUM: 1,
  SEPOLIA: 11155111,
  ARBITRUM: 42161,
  OPTIMISM: 10,
  BASE: 8453,
  POLYGON: 137,
  AVALANCHE: 43114,
  BSC: 56,
  ARBITRUM_SEPOLIA: 421614,
  OPTIMISM_SEPOLIA: 11155420,
  BASE_SEPOLIA: 84532,
} as const

export type ChainId = (typeof CHAIN_IDS)[keyof typeof CHAIN_IDS]

// Chain metadata with RPC endpoints
export interface ChainConfig {
  chain: Chain
  name: string
  nativeCurrency: string
  blockExplorer: string
  // RPC URLs (fallback order)
  rpcUrls: {
    default: string
    alchemy?: string
    infura?: string
  }
  // AA support
  supportsAA: boolean
  entryPointVersion: '0.6' | '0.7'
  // Bridge support for LI.FI
  supportsCrossChain: boolean
  // Testnet flag
  isTestnet: boolean
}

// Environment variables for API keys
const PIMLICO_API_KEY = process.env.PIMLICO_API_KEY || ''
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY || ''
const INFURA_PROJECT_ID = process.env.INFURA_PROJECT_ID || ''

/**
 * Supported chains configuration
 */
export const CHAINS: Record<number, ChainConfig> = {
  // Mainnet chains
  [CHAIN_IDS.ETHEREUM]: {
    chain: mainnet,
    name: 'Ethereum',
    nativeCurrency: 'ETH',
    blockExplorer: 'https://etherscan.io',
    rpcUrls: {
      default: 'https://eth.llamarpc.com',
      alchemy: `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
      infura: `https://mainnet.infura.io/v3/${INFURA_PROJECT_ID}`,
    },
    supportsAA: true,
    entryPointVersion: '0.7',
    supportsCrossChain: true,
    isTestnet: false,
  },
  [CHAIN_IDS.ARBITRUM]: {
    chain: arbitrum,
    name: 'Arbitrum One',
    nativeCurrency: 'ETH',
    blockExplorer: 'https://arbiscan.io',
    rpcUrls: {
      default: 'https://arb1.arbitrum.io/rpc',
      alchemy: `https://arb-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
    },
    supportsAA: true,
    entryPointVersion: '0.7',
    supportsCrossChain: true,
    isTestnet: false,
  },
  [CHAIN_IDS.OPTIMISM]: {
    chain: optimism,
    name: 'Optimism',
    nativeCurrency: 'ETH',
    blockExplorer: 'https://optimistic.etherscan.io',
    rpcUrls: {
      default: 'https://mainnet.optimism.io',
      alchemy: `https://opt-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
    },
    supportsAA: true,
    entryPointVersion: '0.7',
    supportsCrossChain: true,
    isTestnet: false,
  },
  [CHAIN_IDS.BASE]: {
    chain: base,
    name: 'Base',
    nativeCurrency: 'ETH',
    blockExplorer: 'https://basescan.org',
    rpcUrls: {
      default: 'https://mainnet.base.org',
      alchemy: `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
    },
    supportsAA: true,
    entryPointVersion: '0.7',
    supportsCrossChain: true,
    isTestnet: false,
  },
  [CHAIN_IDS.POLYGON]: {
    chain: polygon,
    name: 'Polygon',
    nativeCurrency: 'MATIC',
    blockExplorer: 'https://polygonscan.com',
    rpcUrls: {
      default: 'https://polygon-rpc.com',
      alchemy: `https://polygon-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
      infura: `https://polygon-mainnet.infura.io/v3/${INFURA_PROJECT_ID}`,
    },
    supportsAA: true,
    entryPointVersion: '0.7',
    supportsCrossChain: true,
    isTestnet: false,
  },
  [CHAIN_IDS.AVALANCHE]: {
    chain: avalanche,
    name: 'Avalanche C-Chain',
    nativeCurrency: 'AVAX',
    blockExplorer: 'https://snowtrace.io',
    rpcUrls: {
      default: 'https://api.avax.network/ext/bc/C/rpc',
    },
    supportsAA: true,
    entryPointVersion: '0.7',
    supportsCrossChain: true,
    isTestnet: false,
  },
  [CHAIN_IDS.BSC]: {
    chain: bsc,
    name: 'BNB Smart Chain',
    nativeCurrency: 'BNB',
    blockExplorer: 'https://bscscan.com',
    rpcUrls: {
      default: 'https://bsc-dataseed.binance.org',
    },
    supportsAA: true,
    entryPointVersion: '0.7',
    supportsCrossChain: true,
    isTestnet: false,
  },
  // Testnets
  [CHAIN_IDS.SEPOLIA]: {
    chain: sepolia,
    name: 'Sepolia Testnet',
    nativeCurrency: 'ETH',
    blockExplorer: 'https://sepolia.etherscan.io',
    rpcUrls: {
      default: 'https://rpc.sepolia.org',
      alchemy: `https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
      infura: `https://sepolia.infura.io/v3/${INFURA_PROJECT_ID}`,
    },
    supportsAA: true,
    entryPointVersion: '0.7',
    supportsCrossChain: true,
    isTestnet: true,
  },
  [CHAIN_IDS.BASE_SEPOLIA]: {
    chain: baseSepolia,
    name: 'Base Sepolia',
    nativeCurrency: 'ETH',
    blockExplorer: 'https://sepolia.basescan.org',
    rpcUrls: {
      default: 'https://sepolia.base.org',
      alchemy: `https://base-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
    },
    supportsAA: true,
    entryPointVersion: '0.7',
    supportsCrossChain: true,
    isTestnet: true,
  },
  [CHAIN_IDS.ARBITRUM_SEPOLIA]: {
    chain: {
      id: CHAIN_IDS.ARBITRUM_SEPOLIA,
      name: 'Arbitrum Sepolia',
      nativeCurrency: { name: 'Ethereum', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: ['https://sepolia-rollup.arbitrum.io/rpc'] } },
      blockExplorers: { default: { name: 'Arbiscan', url: 'https://sepolia.arbiscan.io' } },
    } as Chain,
    name: 'Arbitrum Sepolia',
    nativeCurrency: 'ETH',
    blockExplorer: 'https://sepolia.arbiscan.io',
    rpcUrls: {
      default: 'https://sepolia-rollup.arbitrum.io/rpc',
      alchemy: `https://arb-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
    },
    supportsAA: true,
    entryPointVersion: '0.7',
    supportsCrossChain: true,
    isTestnet: true,
  },
}

/**
 * Get Pimlico bundler/paymaster RPC URL for a chain
 */
export function getPimlicoRpcUrl(chainId: number): string {
  if (!PIMLICO_API_KEY) {
    // Use public endpoint (rate limited, testnets only for paymaster)
    return `https://public.pimlico.io/v2/${chainId}/rpc`
  }
  return `https://api.pimlico.io/v2/${chainId}/rpc?apikey=${PIMLICO_API_KEY}`
}

/**
 * Get the best available RPC URL for a chain
 */
export function getRpcUrl(chainId: number): string {
  const config = CHAINS[chainId]
  if (!config) {
    throw new Error(`Unsupported chain: ${chainId}`)
  }
  
  // Priority: Alchemy > Infura > Default (if API keys available)
  if (config.rpcUrls.alchemy && ALCHEMY_API_KEY) {
    return config.rpcUrls.alchemy
  }
  if (config.rpcUrls.infura && INFURA_PROJECT_ID) {
    return config.rpcUrls.infura
  }
  return config.rpcUrls.default
}

/**
 * Get chain configuration by ID
 */
export function getChainConfig(chainId: number): ChainConfig | undefined {
  return CHAINS[chainId]
}

/**
 * Get viem Chain object by ID
 */
export function getViemChain(chainId: number): Chain {
  const config = CHAINS[chainId]
  if (!config) {
    throw new Error(`Unsupported chain: ${chainId}`)
  }
  return config.chain
}

/**
 * Get all supported chain IDs
 */
export function getSupportedChainIds(): number[] {
  return Object.keys(CHAINS).map(Number)
}

/**
 * Get all mainnet chain IDs (for production)
 */
export function getMainnetChainIds(): number[] {
  return Object.entries(CHAINS)
    .filter(([, config]) => !config.isTestnet)
    .map(([id]) => Number(id))
}

/**
 * Get all testnet chain IDs (for development)
 */
export function getTestnetChainIds(): number[] {
  return Object.entries(CHAINS)
    .filter(([, config]) => config.isTestnet)
    .map(([id]) => Number(id))
}

/**
 * Get chains that support cross-chain swaps (for LI.FI)
 */
export function getCrossChainSupportedIds(): number[] {
  return Object.entries(CHAINS)
    .filter(([, config]) => config.supportsCrossChain)
    .map(([id]) => Number(id))
}

/**
 * Check if a chain supports Account Abstraction
 */
export function supportsAccountAbstraction(chainId: number): boolean {
  return CHAINS[chainId]?.supportsAA ?? false
}

/**
 * Default chain for new bots (Arbitrum for low gas)
 */
export const DEFAULT_CHAIN_ID = process.env.NODE_ENV === 'production' 
  ? CHAIN_IDS.ARBITRUM 
  : CHAIN_IDS.BASE_SEPOLIA

/**
 * Get all chains as array (for API responses)
 */
export function getAllChainsInfo(): Array<{
  chainId: number
  name: string
  nativeCurrency: string
  isTestnet: boolean
  supportsAA: boolean
  supportsCrossChain: boolean
}> {
  return Object.entries(CHAINS).map(([id, config]) => ({
    chainId: Number(id),
    name: config.name,
    nativeCurrency: config.nativeCurrency,
    isTestnet: config.isTestnet,
    supportsAA: config.supportsAA,
    supportsCrossChain: config.supportsCrossChain,
  }))
}
