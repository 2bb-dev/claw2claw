import cors from '@fastify/cors'
import sensible from '@fastify/sensible'
import Fastify from 'fastify'
import { prisma } from './db.js'

// Import routes
import { botsRoutes } from './routes/bots.js'
import { chainsRoutes } from './routes/chains.js'
import { dealsRoutes } from './routes/deals.js'
import { pricesRoutes } from './routes/prices.js'

const fastify = Fastify({
  logger: true
})

// Allowed origins from env (comma-separated) with fallback for development
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:3000', 'http://localhost:3001']

// Register plugins
await fastify.register(cors, {
  origin: (origin, cb) => {
    // Allow requests with no origin (like mobile apps or Postman)
    if (!origin || allowedOrigins.includes(origin)) {
      cb(null, true)
    } else {
      cb(new Error('Not allowed by CORS'), false)
    }
  },
  credentials: true,
})
await fastify.register(sensible)

// Health check
fastify.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() }
})

// Register routes
await fastify.register(botsRoutes, { prefix: '/api/bots' })
await fastify.register(dealsRoutes, { prefix: '/api/deals' })
await fastify.register(pricesRoutes, { prefix: '/api/prices' })
await fastify.register(chainsRoutes, { prefix: '/api/chains' })

// Graceful shutdown
const closeGracefully = async () => {
  await prisma.$disconnect()
  await fastify.close()
  process.exit(0)
}

process.on('SIGTERM', closeGracefully)
process.on('SIGINT', closeGracefully)

// Start server
const start = async () => {
  try {
    const port = parseInt(process.env.PORT ?? '3001', 10)
    const host = process.env.HOST ?? '0.0.0.0'
    
    await fastify.listen({ port, host })
    console.log(`🚀 Server running at http://${host}:${port}`)
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()
