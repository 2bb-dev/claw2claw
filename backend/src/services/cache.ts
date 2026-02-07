/**
 * Redis Cache Service
 * Provides cache-aside pattern for LI.FI quotes, prices, and other hot data.
 * Gracefully degrades to direct fetch if Redis is unavailable.
 */
import RedisLib from 'ioredis'

// ioredis ESM interop: default export may be the class or the module
const RedisClient = (RedisLib as any).default ?? RedisLib

let redis: any = null

/**
 * Get or create Redis client
 */
export function getRedis() {
  if (!redis) {
    const url = process.env.REDIS_URL || 'redis://localhost:6379'
    redis = new RedisClient(url, {
      maxRetriesPerRequest: 3,
      retryStrategy(times: number) {
        if (times > 3) return null // Stop retrying after 3 attempts
        return Math.min(times * 200, 2000)
      },
      lazyConnect: true,
    })

    redis.on('error', (err: Error) => {
      console.error('Redis error:', err.message)
    })

    redis.on('connect', () => {
      console.log('Redis connected')
    })
  }
  return redis
}

/**
 * Connect Redis (call at startup)
 */
export async function connectRedis(): Promise<void> {
  try {
    const client = getRedis()
    await client.connect()
  } catch (err) {
    console.warn('Redis connection failed, caching disabled:', (err as Error).message)
  }
}

/**
 * Disconnect Redis (call at shutdown)
 */
export async function disconnectRedis(): Promise<void> {
  if (redis) {
    await redis.quit()
    redis = null
  }
}

/**
 * Cache-aside pattern: return cached value or fetch and cache
 * 
 * @param key - Cache key
 * @param ttlSeconds - Time-to-live in seconds
 * @param fetcher - Function to call on cache miss
 * @returns Cached or freshly fetched data
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>
): Promise<T> {
  try {
    const client = getRedis()
    if (client.status === 'ready') {
      const hit = await client.get(key)
      if (hit) {
        return JSON.parse(hit) as T
      }
    }
  } catch {
    // Redis unavailable, fall through to fetcher
  }

  const data = await fetcher()

  try {
    const client = getRedis()
    if (client.status === 'ready') {
      await client.set(key, JSON.stringify(data), 'EX', ttlSeconds)
    }
  } catch {
    // Cache write failed, data still returned
  }

  return data
}

/**
 * Invalidate a cache key
 */
export async function invalidate(key: string): Promise<void> {
  try {
    const client = getRedis()
    if (client.status === 'ready') {
      await client.del(key)
    }
  } catch {
    // Ignore invalidation failures
  }
}
