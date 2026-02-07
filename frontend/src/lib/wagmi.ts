/**
 * Wagmi Configuration for Claw2Claw
 * 
 * Configures viem client for Sepolia (ENS resolution)
 * and Ethereum mainnet (ENS mainnet resolution fallback).
 */
import { http, createConfig } from 'wagmi'
import { sepolia, mainnet } from 'wagmi/chains'

export const wagmiConfig = createConfig({
  chains: [sepolia, mainnet],
  transports: {
    [sepolia.id]: http(process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL || 'https://rpc.sepolia.org'),
    [mainnet.id]: http('https://eth.llamarpc.com'),
  },
  ssr: true, // Next.js SSR support
})
