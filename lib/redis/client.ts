/**
 * Redis Client Singleton
 *
 * Provides a cached Redis connection with:
 * - Connection pooling (via ioredis)
 * - Automatic reconnection
 * - Graceful degradation when unavailable
 * - Upstash-compatible configuration
 */

import Redis from 'ioredis';

interface RedisCache {
  client: Redis | null;
  isConnected: boolean;
  connectionPromise: Promise<void> | null;
}

declare global {
   
  var redis: RedisCache | undefined;
}

let cached = global.redis;

if (!cached) 
  cached = global.redis = { client: null, isConnected: false, connectionPromise: null };


/**
 * Get or create Redis client singleton
 * Returns null if REDIS_URL is not configured (graceful degradation)
 */
export function getRedisClient(): Redis | null {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) 
    // Silent in production - logged once at startup
    return null;
  

  if (cached!.client && cached!.isConnected) 
    return cached!.client;
  

  // Return existing client even if reconnecting
  if (cached!.client) 
    return cached!.client;
  

  try {
    // Upstash-compatible configuration
    const client = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 3) {
          console.error('[Redis] Max reconnection attempts reached');
          return null; // Stop retrying
        }
        return Math.min(times * 100, 3000); // Exponential backoff
      },
      enableReadyCheck: true,
      lazyConnect: true,
      // TLS configuration for Upstash
      tls: process.env.REDIS_TLS === 'true' || redisUrl.startsWith('rediss://')
        ? { rejectUnauthorized: false }
        : undefined,
      // Connection timeouts
      connectTimeout: 10000,
      commandTimeout: 5000,
    });

    client.on('connect', () => {
      cached!.isConnected = true;
      console.log('[Redis] Connected successfully');
    });

    client.on('ready', () => {
      cached!.isConnected = true;
    });

    client.on('error', (error) => {
      // Only log non-connection errors or first connection error
      if (!error.message.includes('ECONNREFUSED')) 
        console.error('[Redis] Error:', error.message);
      
      cached!.isConnected = false;
    });

    client.on('close', () => {
      cached!.isConnected = false;
    });

    client.on('reconnecting', () => {
      console.log('[Redis] Reconnecting...');
    });

    cached!.client = client;

    // Initiate connection (non-blocking)
    cached!.connectionPromise = client.connect().catch((error) => {
      console.warn('[Redis] Initial connection failed:', error.message);
      cached!.isConnected = false;
    });

    return client;
  } catch (error) {
    console.error('[Redis] Failed to create client:', error);
    return null;
  }
}

/**
 * Check if Redis is currently available and connected
 */
export function isRedisAvailable(): boolean {
  return cached?.isConnected ?? false;
}

/**
 * Wait for Redis connection to be ready
 * Useful during startup to ensure Redis is available
 */
export async function waitForRedis(timeoutMs = 5000): Promise<boolean> {
  const client = getRedisClient();
  if (!client) return false;

  if (cached!.isConnected) return true;

  // Wait for connection with timeout
  const timeout = new Promise<boolean>((resolve) => {
    setTimeout(() => resolve(false), timeoutMs);
  });

  const connected = new Promise<boolean>((resolve) => {
    if (cached!.connectionPromise) 
      cached!.connectionPromise.then(() => resolve(cached!.isConnected));
     else 
      resolve(false);
    
  });

  return Promise.race([connected, timeout]);
}

/**
 * Close Redis connection gracefully
 * Call this during application shutdown
 */
export async function closeRedisConnection(): Promise<void> {
  if (cached?.client) {
    try {
      await cached.client.quit();
    } catch {
      // Force disconnect if quit fails
      cached.client.disconnect();
    }
    cached.client = null;
    cached.isConnected = false;
    cached.connectionPromise = null;
  }
}

/**
 * Execute a Redis command with automatic fallback
 * Returns null if Redis is unavailable instead of throwing
 */
export async function safeRedisCommand<T>(
  command: (client: Redis) => Promise<T>
): Promise<T | null> {
  const client = getRedisClient();
  if (!client || !isRedisAvailable()) 
    return null;
  

  try {
    return await command(client);
  } catch (error) {
    console.warn('[Redis] Command failed:', (error as Error).message);
    return null;
  }
}

export default getRedisClient;
