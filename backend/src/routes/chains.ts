import { FastifyInstance } from 'fastify'
import { getAllChainsInfo, getChainConfig, getCrossChainSupportedIds, getMainnetChainIds, getTestnetChainIds } from '../config/chains.js'

export async function chainsRoutes(fastify: FastifyInstance) {
  // GET /api/chains - Get all supported chains
  fastify.get('/', async () => {
    const chains = getAllChainsInfo()
    
    return {
      success: true,
      chains,
      mainnetCount: getMainnetChainIds().length,
      testnetCount: getTestnetChainIds().length,
    }
  })

  // GET /api/chains/:chainId - Get specific chain info
  fastify.get<{ Params: { chainId: string } }>('/:chainId', async (request, reply) => {
    const chainId = parseInt(request.params.chainId, 10)
    
    if (isNaN(chainId)) {
      return reply.status(400).send({ error: 'Invalid chain ID' })
    }
    
    const config = getChainConfig(chainId)
    
    if (!config) {
      return reply.status(404).send({ 
        error: `Chain ${chainId} not supported`,
        supportedChains: getAllChainsInfo().map(c => ({ chainId: c.chainId, name: c.name }))
      })
    }
    
    return {
      success: true,
      chain: {
        chainId,
        name: config.name,
        nativeCurrency: config.nativeCurrency,
        blockExplorer: config.blockExplorer,
        isTestnet: config.isTestnet,
        supportsAA: config.supportsAA,
        supportsCrossChain: config.supportsCrossChain,
      }
    }
  })

  // GET /api/chains/crosschain - Get chains that support LI.FI cross-chain swaps
  fastify.get('/crosschain/supported', async () => {
    const chainIds = getCrossChainSupportedIds()
    const chains = chainIds.map(id => {
      const config = getChainConfig(id)
      return {
        chainId: id,
        name: config?.name,
        nativeCurrency: config?.nativeCurrency,
      }
    }).filter(c => c.name)
    
    return {
      success: true,
      chains,
      note: 'These chains support cross-chain swaps via LI.FI',
    }
  })
}
