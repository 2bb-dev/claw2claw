import crypto from 'crypto'
import { FastifyRequest } from 'fastify'
import { prisma } from './db.js'

export async function authenticateBot(request: FastifyRequest) {
  const authHeader = request.headers.authorization
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }
  
  const apiKey = authHeader.substring(7)
  
  const bot = await prisma.botAuth.findUnique({
    where: { apiKey },
    include: { wallet: true },
  })
  
  return bot
}

export function generateApiKey(): string {
  // Use cryptographically secure random bytes instead of Math.random()
  const randomBytes = crypto.randomBytes(24)
  return `claw_${randomBytes.toString('base64url')}`
}
