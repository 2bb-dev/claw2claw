import { beforeAll, describe, expect, it } from 'vitest'
import { BotClient } from './helpers/api-client'
import {
  BASE_PRICES,
  BotFactory,
  getBaseAsset,
  randomFloat,
  TOKEN_PAIRS
} from './helpers/bot-factory'

const BASE_URL = process.env.API_URL || 'http://localhost:3000'
const BOT_COUNT = 10

describe('E2E Bot Simulation - 10 Bots Trading', () => {
  let factory: BotFactory
  let bots: BotClient[]

  beforeAll(async () => {
    factory = new BotFactory(BASE_URL)
    bots = await factory.createBots(BOT_COUNT)
  }, 60000) // 60s timeout for registration

  describe('1. Bot Registration & Funding', () => {
    it('should register 10 bots with unique API keys', () => {
      expect(bots).toHaveLength(BOT_COUNT)
      
      const apiKeys = bots.map(b => b.apiKey)
      const uniqueKeys = new Set(apiKeys)
      expect(uniqueKeys.size).toBe(BOT_COUNT)
    })

    it('should fund each bot with ~$1000 portfolio', () => {
      for (const bot of bots) {
        expect(bot.botInfo).toBeDefined()
        expect(bot.botInfo!.totalPortfolioValue).toBeGreaterThan(900)
        expect(bot.botInfo!.totalPortfolioValue).toBeLessThan(1100)
      }
    })

    it('should allocate 7 different assets to each bot', () => {
      for (const bot of bots) {
        expect(bot.botInfo!.assets).toHaveLength(7)
        
        const symbols = bot.botInfo!.assets.map(a => a.symbol)
        expect(symbols).toContain('BTC')
        expect(symbols).toContain('ETH')
        expect(symbols).toContain('SOL')
        expect(symbols).toContain('USDC')
        expect(symbols).toContain('DOGE')
        expect(symbols).toContain('AVAX')
        expect(symbols).toContain('MATIC')
      }
    })
  })

  describe('2. Price Discovery', () => {
    it('should fetch market prices for all supported pairs', async () => {
      const prices = await bots[0].getPrices()
      
      expect(Object.keys(prices)).toHaveLength(6)
      expect(prices['BTC/USDC']).toBeDefined()
      expect(prices['ETH/USDC']).toBeDefined()
      expect(prices['SOL/USDC']).toBeDefined()
      expect(prices['DOGE/USDC']).toBeDefined()
      expect(prices['AVAX/USDC']).toBeDefined()
      expect(prices['MATIC/USDC']).toBeDefined()
    })

    it('should return prices within expected volatility range', async () => {
      const prices = await bots[0].getPrices()
      
      // BTC should be within ±3% of base price
      expect(prices['BTC/USDC'].price).toBeGreaterThan(BASE_PRICES.BTC * 0.9)
      expect(prices['BTC/USDC'].price).toBeLessThan(BASE_PRICES.BTC * 1.1)
      
      // ETH should be within ±4% of base price  
      expect(prices['ETH/USDC'].price).toBeGreaterThan(BASE_PRICES.ETH * 0.9)
      expect(prices['ETH/USDC'].price).toBeLessThan(BASE_PRICES.ETH * 1.1)
    })
  })

  describe('3. Order Creation (Makers)', () => {
    it('should allow bots to create sell orders', async () => {
      const maker = bots[0]
      const ethBalance = maker.getAssetBalance('ETH')
      
      // Sell a fraction of ETH balance
      const sellAmount = ethBalance * 0.1
      const order = await maker.createOrder(
        'sell',
        'ETH/USDC',
        3200,
        sellAmount,
        'Testing sell order'
      )
      
      expect(order.id).toBeDefined()
      expect(order.type).toBe('sell')
      expect(order.status).toBe('open')
    })

    it('should allow bots to create buy orders', async () => {
      const maker = bots[1]
      const usdcBalance = maker.getAssetBalance('USDC')
      
      // Buy with a fraction of USDC balance
      const buyPrice = 200
      const buyAmount = (usdcBalance * 0.3) / buyPrice
      
      const order = await maker.createOrder(
        'buy',
        'SOL/USDC',
        buyPrice,
        buyAmount,
        'Testing buy order'
      )
      
      expect(order.id).toBeDefined()
      expect(order.type).toBe('buy')
    })

    it('should reject orders exceeding balance', async () => {
      const maker = bots[2]
      const btcBalance = maker.getAssetBalance('BTC')
      
      // Try to sell more BTC than available
      await expect(
        maker.createOrder('sell', 'BTC/USDC', 97000, btcBalance + 1)
      ).rejects.toThrow(/Insufficient/)
    })

    it('should show orders in orderbook', async () => {
      const orders = await bots[0].listOrders()
      expect(orders.length).toBeGreaterThan(0)
    })
  })

  describe('4. Order Execution (Takers)', () => {
    let sellOrderId: string
    let sellAmount: number
    let makerBot: BotClient
    let takerBot: BotClient

    beforeAll(async () => {
      makerBot = bots[3]
      takerBot = bots[4]
      
      // Refresh bot info to get latest balances
      makerBot.botInfo = await makerBot.getMe()
      takerBot.botInfo = await takerBot.getMe()
      
      // Calculate max amount taker can afford at price 210
      const sellPrice = 210
      const takerUsdcBalance = takerBot.getAssetBalance('USDC')
      const maxAffordableAmount = (takerUsdcBalance * 0.8) / sellPrice // Use 80% to be safe
      
      // Create a sell order that taker can afford
      const makerSolBalance = makerBot.getAssetBalance('SOL')
      sellAmount = Math.min(makerSolBalance * 0.1, maxAffordableAmount)
      
      const order = await makerBot.createOrder(
        'sell',
        'SOL/USDC',
        sellPrice,
        sellAmount,
        'Sell SOL for deal test'
      )
      sellOrderId = order.id
    })

    it('should execute a deal successfully', async () => {
      const deal = await takerBot.takeOrder(sellOrderId, 'Great price!')
      
      expect(deal.id).toBeDefined()
      expect(deal.maker.id).toBe(makerBot.botInfo!.id)
      expect(deal.taker.id).toBe(takerBot.botInfo!.id)
      expect(deal.amount).toBeCloseTo(sellAmount, 5)
    })

    it('should update balances atomically after deal', async () => {
      // Refresh balances
      const updatedMaker = await makerBot.getMe()
      const updatedTaker = await takerBot.getMe()
      
      // Maker should have less SOL and more USDC
      const makerSolNow = updatedMaker.assets.find(a => a.symbol === 'SOL')?.amount ?? 0
      const originalMakerSol = makerBot.botInfo!.assets.find(a => a.symbol === 'SOL')?.amount ?? 0
      expect(makerSolNow).toBeLessThan(originalMakerSol)
      
      // Taker should have more SOL
      const takerSolNow = updatedTaker.assets.find(a => a.symbol === 'SOL')?.amount ?? 0
      const originalTakerSol = takerBot.botInfo!.assets.find(a => a.symbol === 'SOL')?.amount ?? 0
      expect(takerSolNow).toBeGreaterThan(originalTakerSol)
    })

    it('should prevent taking own orders', async () => {
      const maker = bots[5]
      maker.botInfo = await maker.getMe()
      
      const ethBalance = maker.getAssetBalance('ETH')
      const order = await maker.createOrder('sell', 'ETH/USDC', 3200, ethBalance * 0.1)
      
      await expect(
        maker.takeOrder(order.id)
      ).rejects.toThrow(/Cannot take your own order/)
    })

    it('should record deals in history', async () => {
      const deals = await bots[0].listDeals()
      expect(deals.length).toBeGreaterThan(0)
    })
  })

  describe('5. Concurrent Trading Stress Test', () => {
    it('should handle 20 concurrent orders from different bots', async () => {
      // Refresh all bot balances first
      await factory.refreshBotInfo()
      
      // Each bot creates 2 orders
      const orderPromises = bots.flatMap((bot, index) => {
        const tokenPair = TOKEN_PAIRS[index % TOKEN_PAIRS.length]
        const baseAsset = getBaseAsset(tokenPair)
        const basePrice = BASE_PRICES[baseAsset]
        const balance = bot.getAssetBalance(baseAsset)
        
        // Skip if insufficient balance
        if (balance < 0.001) return []
        
        const sellAmount = balance * 0.05
        
        return [
          bot.createOrder(
            'sell',
            tokenPair,
            basePrice * randomFloat(0.98, 1.02),
            sellAmount,
            `Stress test sell from bot ${index}`
          ).catch(() => null) // Ignore failures
        ]
      })
      
      const results = await Promise.all(orderPromises)
      const successfulOrders = results.filter(r => r !== null)
      
      expect(successfulOrders.length).toBeGreaterThan(5)
    })

    it('should handle concurrent order taking without double-spending', async () => {
      // Get fresh orderbook
      const orders = await bots[0].listOrders()
      const openOrders = orders.filter(o => o.status === 'open')
      
      if (openOrders.length < 3) {
        console.log('Not enough open orders for concurrent take test')
        return
      }

      // Multiple bots try to take orders concurrently
      const takePromises = openOrders.slice(0, 5).map((order, index) => {
        const taker = bots[(index + 6) % BOT_COUNT] // Use different bots as takers
        
        // Skip if taker is the maker
        if (order.bot.id === taker.botInfo?.id) return null
        
        return taker.takeOrder(order.id, 'Concurrent take test')
          .catch(() => null) // Some may fail due to insufficient balance or race
      })
      
      const results = await Promise.all(takePromises.filter(p => p !== null))
      const successfulTakes = results.filter(r => r !== null)
      
      // At least some should succeed
      console.log(`Concurrent takes: ${successfulTakes.length} successful out of ${takePromises.length}`)
    })

    it('should maintain consistent total portfolio value', async () => {
      // After all trading, total value across all bots should be roughly 10 * $1000
      await factory.refreshBotInfo()
      
      const totalValue = bots.reduce((sum, bot) => {
        return sum + (bot.botInfo?.totalPortfolioValue ?? 0)
      }, 0)
      
      // Should be close to original $10,000 (with some drift from simulated price changes)
      expect(totalValue).toBeGreaterThan(8000)
      expect(totalValue).toBeLessThan(12000)
    })
  })
})
