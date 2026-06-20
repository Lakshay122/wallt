import Redis from 'ioredis';
import crypto from 'crypto';


const globalForRedis = global as unknown as { redis: Redis };

export const redis =
  globalForRedis.redis ||
  new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

redis.on('connect', () => {
  console.log('🟢 Connected to Redis successfully.');
});

redis.on('error', (err) => {
  console.error('🔴 Redis connection error:', err);
});

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.redis = redis;
}

/**
 * Invalidate all cached ticket list queries for a specific tenant.
 * Uses a non-blocking SCAN implementation to find and delete matching keys safely.
 */
export async function invalidateTenantTicketsCache(tenantId: string): Promise<void> {
  const matchPattern = `tenant:${tenantId}:tickets:list:*`;
  const statsKey = `tenant:${tenantId}:tickets:stats`;
  let cursor = '0';

  try {
    // Delete the stats cache
    await redis.del(statsKey);

    do {
      const reply = await redis.scan(cursor, 'MATCH', matchPattern, 'COUNT', 100);
      cursor = reply[0];
      const keys = reply[1];

      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== '0');
  } catch (error) {
    console.error(`Failed to invalidate Redis cache for tenant ${tenantId}:`, error);
  }
}

/**
 * Invalidate cached team members list for a specific tenant.
 */
export async function invalidateTenantTeamCache(tenantId: string): Promise<void> {
  const cacheKey = `tenant:${tenantId}:team:list`;
  try {
    await redis.del(cacheKey);
  } catch (error) {
    console.error(`Failed to invalidate Redis team cache for tenant ${tenantId}:`, error);
  }
}

/**
 * Invalidate cached single ticket for a specific tenant and ticketId.
 */
export async function invalidateSingleTicketCache(tenantId: string, ticketId: string): Promise<void> {
  const cacheKey = `tenant:${tenantId}:ticket:${ticketId}`;
  try {
    await redis.del(cacheKey);
  } catch (error) {
    console.error(`Failed to invalidate single ticket cache for tenant ${tenantId}, ticket ${ticketId}:`, error);
  }
}

/**
 * Sliding window rate limiter for AI Suggestion requests using Redis.
 * Restricts each tenant to 10 requests per hour.
 * Returns { allowed: boolean }
 */
export async function checkAiSuggestRateLimit(tenantId: string): Promise<{ allowed: boolean; token?: string }> {
  const key = `ai-rate-limit:${tenantId}`;
  const limit = 10;
  const currentTime = Math.floor(Date.now() / 1000);
  const windowStart = currentTime - 3600; // 1 hour window

  try {
    // 1. Remove expired entries (older than 1 hour)
    await redis.zremrangebyscore(key, 0, windowStart);

    // 2. Count active requests in the last hour
    const count = await redis.zcard(key);

    // 3. Reject if limit reached
    if (count >= limit) {
      console.warn(`⚠️ Rate limit reached for tenant ${tenantId}: ${count}/${limit} requests in the last hour.`);
      return { allowed: false };
    }

    // 4. Record new request and update TTL
    const uniqueMember = `${currentTime}-${crypto.randomUUID()}`;
    await redis.zadd(key, currentTime, uniqueMember);
    await redis.expire(key, 3700);

    return { allowed: true, token: uniqueMember };
  } catch (error) {
    console.error(`🔴 AI suggest rate limiter error for tenant ${tenantId} (falling back to allowed):`, error);
    // Graceful fallback: fail open
    return { allowed: true };
  }
}

/**
 * Refund a rate limit token if AI generation failed or returned the fallback message.
 */
export async function refundAiSuggestRateLimit(tenantId: string, token: string): Promise<void> {
  const key = `ai-rate-limit:${tenantId}`;
  try {
    await redis.zrem(key, token);
    console.log(`🔄 Refunded AI rate limit token for tenant ${tenantId}`);
  } catch (error) {
    console.error(`🔴 Failed to refund AI rate limit token for tenant ${tenantId}:`, error);
  }
}

/**
 * Retrieve the current number of AI suggestion requests in the active sliding window.
 */
export async function getAiSuggestCount(tenantId: string): Promise<number> {
  const key = `ai-rate-limit:${tenantId}`;
  const currentTime = Math.floor(Date.now() / 1000);
  const windowStart = currentTime - 3600;

  try {
    await redis.zremrangebyscore(key, 0, windowStart);
    return await redis.zcard(key);
  } catch (error) {
    console.error(`Error getting AI suggest count for tenant ${tenantId}:`, error);
    return 0;
  }
}


