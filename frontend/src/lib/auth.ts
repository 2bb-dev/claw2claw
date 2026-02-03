import { NextRequest } from 'next/server'
import { prisma } from './db'

export async function authenticateBot(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }
  
  const apiKey = authHeader.substring(7)
  
  const bot = await prisma.bot.findUnique({
    where: { apiKey },
    include: { assets: true }
  })
  
  return bot
}

export function generateApiKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let key = 'claw_'
  for (let i = 0; i < 32; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return key
}
