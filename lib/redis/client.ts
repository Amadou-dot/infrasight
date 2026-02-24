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
import { logger } from '../monitoring/logger';

interface RedisCache {
  client: Redis | null;
  isConnected: boolean;
  connectionPromise: Promise<void> | null;
}

declare global {
  var redis: RedisCache | undefined;
}

let cached = global.redis;

if (!cached) cached = global.redis = { client: null, isConnected: false, connectionPromise: null };

/**
 * Get or create Redis client singleton
 * Returns null if REDIS_URL is not configured (graceful degradation)
 */
export function getRedisClient(): Redis | null {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl)
    // Silent in production - logged once at startup
    return null;

  if (cached!.client && cached!.isConnected) return cached!.client;

  // Return existing client even if reconnecting
  if (cached!.client) return cached!.client;

  try {
    // Upstash-compatible configuration
    const client = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: times => {
        if (times > 3) {
          logger.error('Redis max reconnection attempts reached');
          return null; // Stop retrying
        }
        return Math.min(times * 100, 3000); // Exponential backoff
      },
      enableReadyCheck: true,
      lazyConnect: true,
      // TLS configuration for Upstash
      tls:
        process.env.REDIS_TLS === 'true' || redisUrl.startsWith('rediss://')
          ? {
              rejectUnauthorized: process.env.REDIS_TLS_INSECURE === 'true'
                ? false
                : process.env.NODE_ENV === 'production',
            }
          : undefined,
      // Connection timeouts
      connectTimeout: 10000,
      commandTimeout: 5000,
    });

    client.on('connect', () => {
      cached!.isConnected = true;
      logger.info('Redis connected successfully');
    });

    client.on('ready', () => {
      cached!.isConnected = true;
    });

    client.on('error', error => {
      // Only log non-connection errors or first connection error
      if (!error.message.includes('ECONNREFUSED')) logger.error('Redis error', { error: error.message });

      cached!.isConnected = false;
    });

    client.on('close', () => {
      cached!.isConnected = false;
    });

    client.on('reconnecting', () => {
      logger.info('Redis reconnecting');
    });

    cached!.client = client;

    // Initiate connection (non-blocking)
    cached!.connectionPromise = client.connect().catch(error => {
      logger.warn('Redis initial connection failed', { error: error.message });
      cached!.isConnected = false;
    });

    return client;
  } catch (error) {
    logger.error('Redis failed to create client', { error: error instanceof Error ? error.message : String(error) });
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
  const timeout = new Promise<boolean>(resolve => {
    setTimeout(() => resolve(false), timeoutMs);
  });

  const connected = new Promise<boolean>(resolve => {
    if (cached!.connectionPromise)
      cached!.connectionPromise.then(() => resolve(cached!.isConnected));
    else resolve(false);
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
  if (!client || !isRedisAvailable()) return null;

  try {
    return await command(client);
  } catch (error) {
    logger.warn('Redis command failed', { error: (error as Error).message });
    return null;
  }
}

export default getRedisClient;
