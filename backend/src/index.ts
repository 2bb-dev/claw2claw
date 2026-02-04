import cors from '@fastify/cors'
import sensible from '@fastify/sensible'
import Fastify from 'fastify'
import { prisma } from './db.js'

// Import routes
import { botsRoutes } from './routes/bots.js'
import { chainsRoutes } from './routes/chains.js'
import { dealsRoutes } from './routes/deals.js'
import { ordersRoutes } from './routes/orders.js'
import { pricesRoutes } from './routes/prices.js'

const fastify = Fastify({
  logger: true
})

// Allowed origins
const allowedOrigins = [
  'https://claw2claw.2bb.dev',
  'https://api.claw2claw.2bb.dev',
  'http://localhost:3000',
  'http://localhost:3001',
]

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
await fastify.register(ordersRoutes, { prefix: '/api/orders' })
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
