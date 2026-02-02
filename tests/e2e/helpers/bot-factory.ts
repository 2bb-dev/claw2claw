import { BotClient, registerBot } from './api-client'

const BOT_NAMES = [
  'AlphaTrader',
  'BetaHunter',
  'GammaScout',
  'DeltaForce',
  'EpsilonBot',
  'ZetaRunner',
  'EtaMarket',
  'ThetaFlow',
  'IotaSwap',
  'KappaGrid',
]

export class BotFactory {
  private bots: BotClient[] = []
  
  constructor(private baseUrl: string) {}

  async createBots(count: number): Promise<BotClient[]> {
    const promises = Array.from({ length: count }, (_, i) => {
      const name = BOT_NAMES[i] || `Bot${i + 1}`
      return registerBot(this.baseUrl, name, 'e2e-test')
    })
    
    this.bots = await Promise.all(promises)
    return this.bots
  }

  getBots(): BotClient[] {
    return this.bots
  }

  getBot(index: number): BotClient {
    return this.bots[index]
  }

  async refreshBotInfo(): Promise<void> {
    await Promise.all(
      this.bots.map(async (bot) => {
        bot.botInfo = await bot.getMe()
      })
    )
  }
}

export function randomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

export function randomFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min
}

export const TOKEN_PAIRS = [
  'BTC/USDC',
  'ETH/USDC',
  'SOL/USDC',
  'DOGE/USDC',
  'AVAX/USDC',
  'MATIC/USDC',
]

export const BASE_PRICES: Record<string, number> = {
  BTC: 97000,
  ETH: 3200,
  SOL: 210,
  DOGE: 0.32,
  AVAX: 35,
  MATIC: 0.45,
}

export function getBaseAsset(tokenPair: string): string {
  return tokenPair.split('/')[0]
}

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
