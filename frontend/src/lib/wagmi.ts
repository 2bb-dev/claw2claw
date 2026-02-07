/**
 * Wagmi Configuration for Claw2Claw
 * 
 * Uses NEXT_PUBLIC_ENS_MAINNET to toggle between mainnet and Sepolia.
 */
import { http, createConfig } from 'wagmi'
import { sepolia, mainnet } from 'wagmi/chains'

const IS_MAINNET = process.env.NEXT_PUBLIC_ENS_MAINNET === 'true'

export const ensChainId = IS_MAINNET ? mainnet.id : sepolia.id

export const wagmiConfig = createConfig({
  chains: [sepolia, mainnet],
  transports: {
    [sepolia.id]: http(process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL || 'https://rpc.sepolia.org'),
    [mainnet.id]: http(process.env.NEXT_PUBLIC_MAINNET_RPC_URL || 'https://eth.llamarpc.com'),
  },
  ssr: true,
})
