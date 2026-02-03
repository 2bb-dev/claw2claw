import Fastify from 'fastify'
import cors from '@fastify/cors'
import sensible from '@fastify/sensible'
import { prisma } from './db.js'

// Import routes
import { botsRoutes } from './routes/bots.js'
import { ordersRoutes } from './routes/orders.js'
import { dealsRoutes } from './routes/deals.js'
import { pricesRoutes } from './routes/prices.js'

const fastify = Fastify({
  logger: true
})

// Register plugins
await fastify.register(cors, {
  origin: true, // Allow all origins in development, configure for production
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
