/**
 * Price Feed Service
 * Fetches real-time prices from CoinGecko for any token
 * Dynamically looks up tokens by symbol using CoinGecko's search
 */

// Cache for CoinGecko IDs (symbol -> coingecko ID)
const symbolToIdCache: Map<string, string> = new Map([
  // Common tokens for faster lookup
  ['BTC', 'bitcoin'],
  ['ETH', 'ethereum'],
  ['SOL', 'solana'],
  ['USDC', 'usd-coin'],
  ['USDT', 'tether'],
  ['DOGE', 'dogecoin'],
  ['AVAX', 'avalanche-2'],
  ['MATIC', 'matic-network'],
  ['ARB', 'arbitrum'],
  ['OP', 'optimism'],
  ['LINK', 'chainlink'],
  ['UNI', 'uniswap'],
  ['AAVE', 'aave'],
  ['SNX', 'synthetix-network-token'],
  ['CRV', 'curve-dao-token'],
  ['MKR', 'maker'],
  ['COMP', 'compound-governance-token'],
  ['LDO', 'lido-dao'],
  ['APE', 'apecoin'],
  ['SHIB', 'shiba-inu'],
  ['PEPE', 'pepe'],
  ['WLD', 'worldcoin-wld'],
  ['BLUR', 'blur'],
])

// Cache for prices (with TTL)
interface CachedPrice {
  price: number
  change24h: number
  updatedAt: Date
}

const priceCache: Map<string, CachedPrice> = new Map()
const CACHE_TTL_MS = 60_000 // 1 minute

/**
 * Look up CoinGecko ID for a token symbol (with caching)
 */
async function getCoinGeckoId(symbol: string): Promise<string | null> {
  const upperSymbol = symbol.toUpperCase()
  
  // Check cache first
  if (symbolToIdCache.has(upperSymbol)) {
    return symbolToIdCache.get(upperSymbol)!
  }
  
  // Search CoinGecko for the token
  try {
    const url = `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(symbol)}`
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    })
    
    if (!response.ok) {
      console.error(`CoinGecko search failed: ${response.status}`)
      return null
    }
    
    const data = await response.json()
    const coins = data.coins || []
    
    // Find exact match by symbol
    const match = coins.find((c: { symbol: string }) => 
      c.symbol.toUpperCase() === upperSymbol
    )
    
    if (match) {
      symbolToIdCache.set(upperSymbol, match.id)
      return match.id
    }
    
    return null
  } catch (error) {
    console.error(`CoinGecko search error for ${symbol}:`, error)
    return null
  }
}

/**
 * Fetch prices for multiple tokens at once
 */
export async function fetchPricesForTokens(symbols: string[]): Promise<Record<string, CachedPrice>> {
  const uniqueSymbols = [...new Set(symbols.map(s => s.toUpperCase()))]
  const results: Record<string, CachedPrice> = {}
  
  // Resolve CoinGecko IDs for all symbols
  const idMap: Record<string, string> = {}
  for (const symbol of uniqueSymbols) {
    const id = await getCoinGeckoId(symbol)
    if (id) {
      idMap[symbol] = id
    }
  }
  
  if (Object.keys(idMap).length === 0) {
    return results
  }
  
  // Fetch prices from CoinGecko
  const ids = Object.values(idMap).join(',')
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`
  
  try {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    })
    
    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status}`)
    }
    
    const data = await response.json()
    const now = new Date()
    
    for (const [symbol, geckoId] of Object.entries(idMap)) {
      const tokenData = data[geckoId]
      if (tokenData) {
        const cachedPrice: CachedPrice = {
          price: tokenData.usd ?? 0,
          change24h: tokenData.usd_24h_change ?? 0,
          updatedAt: now,
        }
        results[symbol] = cachedPrice
        priceCache.set(symbol, cachedPrice)
      }
    }
    
    return results
  } catch (error) {
    console.error('CoinGecko fetch failed:', error)
    
    // Return cached prices if available
    for (const symbol of uniqueSymbols) {
      const cached = priceCache.get(symbol)
      if (cached) {
        results[symbol] = cached
      }
    }
    
    return results
  }
}

/**
 * Get price for a single token
 */
export async function getTokenPrice(symbol: string): Promise<CachedPrice | null> {
  const upperSymbol = symbol.toUpperCase()
  
  // Stablecoins always return $1
  if (upperSymbol === 'USDC' || upperSymbol === 'USDT' || upperSymbol === 'DAI') {
    return {
      price: 1,
      change24h: 0,
      updatedAt: new Date(),
    }
  }
  
  // Check cache first
  const cached = priceCache.get(upperSymbol)
  if (cached && Date.now() - cached.updatedAt.getTime() < CACHE_TTL_MS) {
    return cached
  }
  
  // Fetch fresh price
  const prices = await fetchPricesForTokens([upperSymbol])
  return prices[upperSymbol] ?? null
}

/**
 * Get prices for all tokens in an order or portfolio
 */
export async function getPricesForTokenPairs(pairs: string[]): Promise<Record<string, {
  price: number
  change24h: number
  source: string
  updatedAt: string
}>> {
  // Extract unique base tokens from pairs (e.g., "BTC/USDC" -> "BTC")
  const tokens = new Set<string>()
  for (const pair of pairs) {
    const [base, quote] = pair.split('/')
    if (base) tokens.add(base.toUpperCase())
    if (quote) tokens.add(quote.toUpperCase())
  }
  
  const prices = await fetchPricesForTokens([...tokens])
  const result: Record<string, { price: number; change24h: number; source: string; updatedAt: string }> = {}
  
  for (const pair of pairs) {
    const [base, quote] = pair.split('/')
    const basePrice = prices[base?.toUpperCase()] ?? priceCache.get(base?.toUpperCase())
    const quotePrice = prices[quote?.toUpperCase()] ?? priceCache.get(quote?.toUpperCase())
    
    if (basePrice && quotePrice && quotePrice.price > 0) {
      result[pair] = {
        price: parseFloat((basePrice.price / quotePrice.price).toFixed(8)),
        change24h: parseFloat((basePrice.change24h - quotePrice.change24h).toFixed(2)),
        source: 'coingecko',
        updatedAt: basePrice.updatedAt.toISOString(),
      }
    } else if (basePrice) {
      // Quote is USD
      result[pair] = {
        price: parseFloat(basePrice.price.toFixed(getDecimalPlaces(basePrice.price))),
        change24h: parseFloat(basePrice.change24h.toFixed(2)),
        source: 'coingecko',
        updatedAt: basePrice.updatedAt.toISOString(),
      }
    }
  }
  
  return result
}

/**
 * Helper to determine decimal places based on price magnitude
 */
function getDecimalPlaces(price: number): number {
  if (price >= 1000) return 2
  if (price >= 1) return 4
  if (price >= 0.01) return 6
  return 8
}

/**
 * Convert amount from one token to another at current prices
 */
export async function convertTokenAmount(
  fromSymbol: string,
  toSymbol: string,
  amount: number
): Promise<number | null> {
  const fromPrice = await getTokenPrice(fromSymbol)
  const toPrice = await getTokenPrice(toSymbol)
  
  if (!fromPrice || !toPrice || toPrice.price === 0) {
    return null
  }
  
  const usdValue = amount * fromPrice.price
  return usdValue / toPrice.price
}


