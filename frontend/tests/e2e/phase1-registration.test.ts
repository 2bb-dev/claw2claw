import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Phase 1 E2E Test: Bot Registration with ENS and AA Wallet
 * 
 * Tests the complete onboarding flow:
 * 1. Register bot via /api/bots/register
 * 2. Verify ENS subdomain is generated
 * 3. Verify AA wallet is created (if configured)
 * 4. Verify wallet portfolio page loads
 */

const BASE_URL = process.env.API_URL || 'http://localhost:3001'

interface RegistrationResponse {
  success: boolean
  bot: {
    id: string
    apiKey: string
    ensName: string | null
    wallet: string | null
  }
  important?: string
  walletInfo?: string
}

interface BotProfile {
  id: string
  name: string
  ensName: string | null
  walletAddress: string | null
  assets: Array<{ symbol: string; amount: number; usdValue: number }>
  totalPortfolioValue: number
  openOrders: Array<{ id: string; type: string; tokenPair: string }>
  stats: {
    totalOrders: number
    totalDeals: number
    successRate: number
  }
}

async function registerBot(name: string, options: {
  humanOwner?: string
  createWallet?: boolean
} = {}): Promise<RegistrationResponse> {
  const response = await fetch(`${BASE_URL}/api/bots/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      humanOwner: options.humanOwner || 'phase1-e2e-test',
      createWallet: options.createWallet ?? true,
    }),
  })

  const data = await response.json()
  
  if (!response.ok) {
    throw new Error(data.error || `Registration failed: ${response.status}`)
  }
  
  return data
}

async function getBotProfile(botId: string): Promise<BotProfile> {
  const response = await fetch(`${BASE_URL}/api/bots/${botId}`)
  
  if (!response.ok) {
    throw new Error(`Failed to fetch bot profile: ${response.status}`)
  }
  
  const data = await response.json()
  return data.bot
}

async function getBotMe(apiKey: string): Promise<BotProfile> {
  const response = await fetch(`${BASE_URL}/api/bots/me`, {
    headers: { 
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
  })
  
  if (!response.ok) {
    throw new Error(`Failed to fetch /me: ${response.status}`)
  }
  
  const data = await response.json()
  return data.bot
}

describe('Phase 1: Bot Registration with ENS and Wallet', () => {
  let registeredBot: RegistrationResponse
  let uniqueBotName: string
  
  beforeAll(async () => {
    // Generate unique bot name for this test run
    uniqueBotName = `test-bot-${Date.now()}`
    
    // Register the bot
    registeredBot = await registerBot(uniqueBotName, {
      createWallet: true,
      humanOwner: 'phase1-e2e-test'
    })
  }, 30000) // 30s timeout for wallet creation

  describe('1. Bot Registration', () => {
    it('should register bot successfully', () => {
      expect(registeredBot.success).toBe(true)
      expect(registeredBot.bot).toBeDefined()
    })

    it('should return unique bot ID', () => {
      expect(registeredBot.bot.id).toBeDefined()
      expect(registeredBot.bot.id.length).toBeGreaterThan(10)
    })

    it('should return API key', () => {
      expect(registeredBot.bot.apiKey).toBeDefined()
      expect(registeredBot.bot.apiKey.length).toBeGreaterThan(20)
    })

    it('should include save API key warning', () => {
      expect(registeredBot.important).toContain('SAVE YOUR API KEY')
    })
  })

  describe('2. ENS Subdomain Generation', () => {
    it('should generate ENS subdomain', () => {
      expect(registeredBot.bot.ensName).toBeDefined()
      expect(registeredBot.bot.ensName).not.toBeNull()
    })

    it('should use claw2claw.eth domain', () => {
      expect(registeredBot.bot.ensName).toContain('.claw2claw.eth')
    })

    it('should include bot name in subdomain', () => {
      // Subdomain should be based on bot name (sanitized)
      const subdomain = registeredBot.bot.ensName!.split('.')[0]
      expect(subdomain).toContain('test-bot')
    })
  })

  describe('3. AA Wallet Creation', () => {
    it('should create AA wallet', () => {
      // Note: Wallet may be null if MASTER_SECRET not configured
      if (registeredBot.bot.wallet) {
        expect(registeredBot.bot.wallet).toMatch(/^0x[a-fA-F0-9]{40}$/)
      } else {
        console.warn('Wallet not created - MASTER_SECRET may not be configured')
      }
    })

    it('should include wallet info message when wallet created', () => {
      if (registeredBot.bot.wallet) {
        expect(registeredBot.walletInfo).toContain('Deposit assets to')
        expect(registeredBot.walletInfo).toContain(registeredBot.bot.wallet)
      }
    })
  })

  describe('4. Bot Profile API', () => {
    it('should fetch bot by ID via /api/bots/:id', async () => {
      const profile = await getBotProfile(registeredBot.bot.id)
      
      expect(profile.id).toBe(registeredBot.bot.id)
      expect(profile.ensName).toBe(registeredBot.bot.ensName)
    })

    it('should fetch bot via /api/bots/me with API key', async () => {
      const profile = await getBotMe(registeredBot.bot.apiKey)
      
      expect(profile.id).toBe(registeredBot.bot.id)
      expect(profile.name).toBe(uniqueBotName)
    })

    it('should show empty assets for new bot', async () => {
      const profile = await getBotProfile(registeredBot.bot.id)
      
      expect(profile.assets).toBeDefined()
      expect(profile.assets.length).toBe(0) // New bots start empty
    })

    it('should show zero total portfolio value', async () => {
      const profile = await getBotProfile(registeredBot.bot.id)
      
      expect(profile.totalPortfolioValue).toBe(0)
    })

    it('should show empty orders', async () => {
      const profile = await getBotProfile(registeredBot.bot.id)
      
      expect(profile.openOrders).toBeDefined()
      expect(profile.openOrders.length).toBe(0)
    })

    it('should show stats with zero values', async () => {
      const profile = await getBotProfile(registeredBot.bot.id)
      
      expect(profile.stats.totalOrders).toBe(0)
      expect(profile.stats.totalDeals).toBe(0)
      expect(profile.stats.successRate).toBe(0)
    })
  })

  describe('5. Wallet Address Consistency', () => {
    it('should return same wallet address in profile as registration', async () => {
      if (!registeredBot.bot.wallet) {
        console.warn('Skipping - no wallet created')
        return
      }

      const profile = await getBotProfile(registeredBot.bot.id)
      expect(profile.walletAddress).toBe(registeredBot.bot.wallet)
    })

    it('should return same ENS name in profile as registration', async () => {
      const profile = await getBotProfile(registeredBot.bot.id)
      expect(profile.ensName).toBe(registeredBot.bot.ensName)
    })
  })

  describe('6. Multiple Bot Registration', () => {
    it('should generate unique ENS subdomains for different bots', async () => {
      const bot2 = await registerBot(`test-bot-2-${Date.now()}`, {
        createWallet: true
      })
      
      expect(bot2.bot.ensName).not.toBe(registeredBot.bot.ensName)
    })

    it('should generate unique wallet addresses for different bots', async () => {
      const bot3 = await registerBot(`test-bot-3-${Date.now()}`, {
        createWallet: true
      })
      
      if (registeredBot.bot.wallet && bot3.bot.wallet) {
        expect(bot3.bot.wallet).not.toBe(registeredBot.bot.wallet)
      }
    })

    it('should generate unique API keys for different bots', async () => {
      const bot4 = await registerBot(`test-bot-4-${Date.now()}`, {
        createWallet: true
      })
      
      expect(bot4.bot.apiKey).not.toBe(registeredBot.bot.apiKey)
    })
  })

  describe('7. Error Handling', () => {
    it('should reject registration without name', async () => {
      await expect(
        fetch(`${BASE_URL}/api/bots/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ humanOwner: 'test' }),
        }).then(r => {
          if (!r.ok) throw new Error('Expected error')
          return r.json()
        })
      ).rejects.toThrow()
    })

    it('should return 401 for /me without API key', async () => {
      const response = await fetch(`${BASE_URL}/api/bots/me`)
      expect(response.status).toBe(401)
    })

    it('should return 401 for /me with invalid API key', async () => {
      const response = await fetch(`${BASE_URL}/api/bots/me`, {
        headers: { 'Authorization': 'Bearer invalid-api-key-12345' }
      })
      expect(response.status).toBe(401)
    })

    it('should return 404 for non-existent bot ID', async () => {
      const response = await fetch(`${BASE_URL}/api/bots/nonexistent-id-12345`)
      expect(response.status).toBe(404)
    })
  })
})

describe('Integration: Chains API', () => {
  it('should list supported chains', async () => {
    const response = await fetch(`${BASE_URL}/api/chains`)
    expect(response.ok).toBe(true)
    
    const data = await response.json()
    expect(data.success).toBe(true)
    expect(data.chains.length).toBeGreaterThan(0)
  })

  it('should include mainnet chains', async () => {
    const response = await fetch(`${BASE_URL}/api/chains`)
    const data = await response.json()
    
    const chainNames = data.chains.map((c: { name: string }) => c.name)
    expect(chainNames).toContain('Ethereum')
    expect(chainNames).toContain('Arbitrum One')
    expect(chainNames).toContain('Base')
  })

  it('should include chain details', async () => {
    const response = await fetch(`${BASE_URL}/api/chains/1`)
    expect(response.ok).toBe(true)
    
    const data = await response.json()
    expect(data.chain.name).toBe('Ethereum')
    expect(data.chain.nativeCurrency).toBe('ETH')
    expect(data.chain.supportsAA).toBe(true)
    expect(data.chain.supportsCrossChain).toBe(true)
  })
})
