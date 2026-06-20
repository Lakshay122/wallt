# Redis Caching & Sliding Window Rate Limiting

This document describes the caching patterns, invalidation loops, and rate-limiting rules powered by Redis.

---

## Technical Files & Scoping Context

- **Redis client Connection:** [redis.ts](file:///Users/lakshaybansal/code/personal/wallt_assingment/client/src/lib/redis.ts) — Client singleton using `ioredis` with helper methods for cache invalidation and rate limiting.
- **Cache Implementation (Listing):** [route.ts](file:///Users/lakshaybansal/code/personal/wallt_assingment/client/src/app/api/tickets/route.ts) — Dynamic query filters listing cache.
- **Cache Implementation (Details):** [route.ts](file:///Users/lakshaybansal/code/personal/wallt_assingment/client/src/app/api/tickets/%5Bid%5D/route.ts) — Scoped single ticket detail cache.
- **AI Suggest Rate Limiter:** [route.ts](file:///Users/lakshaybansal/code/personal/wallt_assingment/client/src/app/api/tickets/%5Bid%5D/suggest/route.ts) — Sliding window rate limiter hook.

---

## Caching Strategy

To achieve low-latency response times, ticket read operations are cached.

### 1. Deterministic Cache Keys
- **Ticket List Cache Key Pattern:**
  `tenant:{tenantId}:tickets:list:{status}:{priority}:{assignedToId}:{limit}:{cursor}`
- **Single Ticket Detail Cache Key Pattern:**
  `tenant:{tenantId}:ticket:{ticketId}`

This ensures that queries are strictly separated by tenant boundaries and specific parameters. All cache keys have a default Time-To-Live (TTL) expiration of **1 hour (3600 seconds)**.

### 2. Cache Invalidation
Whenever a mutating action takes place (a new ticket is created, a ticket is modified, or a reply is added), the system triggers an invalidation:
- **Single Ticket Invalidation:** Deletes `tenant:{tenantId}:ticket:{ticketId}` directly.
- **List Invalidation:** Runs a non-blocking `SCAN` command to locate all list variations (keys starting with `tenant:{tenantId}:tickets:list:*`) and deletes them, preventing stale search lists.

```typescript
export async function invalidateTenantTicketsCache(tenantId: string) {
  if (!redis) return;
  const pattern = `tenant:${tenantId}:tickets:list:*`;
  let cursor = '0';
  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = nextCursor;
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } while (cursor !== '0');
}
```

---

## Sliding Window Rate Limiting

To prevent AI service abuse, we enforce a strict limit of **10 AI suggest requests per hour per tenant**.

- **Mechanism:** Implemented using a Redis Sorted Set (`ZSET`).
- **Keyspace:** `tenant:{tenantId}:rate_limit:ai_suggest`
- **Execution Flow:**
  1. Remove elements older than 1 hour: `ZREMRANGEBYSCORE key -inf (currentTime - 3600)`
  2. Query the current set cardinality: `ZCARD key`
  3. If cardinality is $\ge 10$, reject the request (`429 Too Many Requests`).
  4. If cardinality is $< 10$, add a unique member key: `ZADD key currentTime uuid` and refresh key TTL (`EXPIRE` 3700s).
- **Refund Policy:** If the upstream AI service fails or yields an error, we execute a refund to avoid consuming the user's quota. This is done by removing the unique token from the ZSET using `ZREM`.

This guarantees precise, rolling hourly usage checking without blocky resets. If Redis goes offline, the system falls back gracefully to allow the AI call to proceed (fail-open strategy).

---

## 🔗 Connection with Other Modules

- **Ticket Listing & Details Routes:** Intercepts GET queries to serve responses directly from Redis memory before hitting PostgreSQL via Prisma.
- **AI Suggest Route:** Checks sliding window limits on incoming SSE queries and updates rate quotas, refunding tokens if downstream streams error.
- **Agent Management / Admin Dashboard:** Exposes real-time stats of current AI usage (`GET /api/tickets/ai-usage`) to let agents track their remaining tokens in the user interface.

---

## ⚖️ Module Trade-offs & Decisions

### 1. SCAN-Based Invalidation vs. Cache Key Registry
* **Decision:** We used a Redis `SCAN` to search and delete list cache keys matching a pattern, rather than maintaining a separate Redis Set registering active keys.
* **Pros:** Simpler execution code, stateless on creation (no need to update a registry set during GET requests), and zero risk of registry drift.
* **Cons:** `SCAN` takes slightly more Redis CPU cycles during mutation requests. We optimized this by setting a `COUNT` parameter of 100 to process batches quickly and prevent blocking single-threaded Redis execution.

### 2. Sliding Window Rate Limiting (ZSET) vs. Fixed Window (INCR + EXPIRE)
* **Decision:** Used a Redis Sorted Set (`ZSET`) to store request timestamps for sliding window validation.
* **Pros:** Highly accurate. Prevents the "burst" edge case of fixed-window limiters, where a user could exhaust 10 tokens at 1:59 and another 10 tokens at 2:01 (effectively issuing 20 requests in 2 minutes).
* **Cons:** Consumes slightly more memory since it stores individual timestamp elements inside the set. At a scale of 10 requests per hour, this memory usage is virtually negligible.
