# Tenant Isolation (tenantId Scoped Queries)

This document describes how multi-tenant isolation boundaries are strictly enforced across the application stack.

---

## Technical Files & Scoping Context

- **Middleware Header Injection:** [middleware.ts](file:///Users/lakshaybansal/code/personal/wallt_assingment/client/src/middleware.ts) — Extracts and forwards the active `tenantId` (under headers key `x-tenant-id`).
- **Prisma Scoped Base Handler:** [route.ts](file:///Users/lakshaybansal/code/personal/wallt_assingment/client/src/app/api/tickets/route.ts) — Main tickets collection CRUD, showing scoped SQL filters.
- **Replies Scoping:** [route.ts](file:///Users/lakshaybansal/code/personal/wallt_assingment/client/src/app/api/tickets/%5Bid%5D/replies/route.ts) — Sub-thread replies scoping logic.

---

## Technical Implementation Details

Every database query and modification checks the tenant isolation boundaries:

1. **Header Injection (Edge Middleware):**
   When the user is authenticated, their verified JWT contains their assigned `tenantId`. The middleware extracts this value and forwards it as a custom HTTP header:
   ```typescript
   requestHeaders.set('x-tenant-id', payload.tenantId);
   ```

2. **Query Filtering:**
   All routes extract `x-tenant-id` and inject it directly into the database query rules:
   ```typescript
   const tenantId = req.headers.get('x-tenant-id')!;
   const tickets = await prisma.ticket.findMany({
     where: {
       tenantId: tenantId, // Strict scope filter
       status: statusParam,
     }
   });
   ```

3. **Creation Scoping:**
   On resource creation, the `tenantId` extracted from the token is permanently bound to the created record:
   ```typescript
   const ticket = await prisma.ticket.create({
     data: {
       title,
       description,
       tenantId, // Isolated organization context
       createdById: userId,
     }
   });
   ```

---

## Tenant Isolation Boundary Verification

- **Cross-Tenant Prevention:**
  If an Agent from Tenant A attempts to read or mutate a Ticket (`ticketId`) from Tenant B, the API returns a `404 Not Found` response. This is handled by requiring both parameters inside the query constraint:
  ```typescript
  const ticket = await prisma.ticket.findFirst({
    where: {
      id: ticketId,
      tenantId: tenantId // Asserts that the ticket belongs to the user's tenant
    }
  });
  ```

---

## 🔗 Connection with Other Modules

- **Database / Prisma Schema:** The `Tenant` table has a one-to-many relationship with `User`, `Ticket`, `TicketReply`, `WebhookConfig`, and `FailedNotification`. These relationships are locked with foreign keys (`ON DELETE CASCADE` or set to null, depending on the model).
- **Redis Caching:** Cache keys deterministic prefixes (`tenant:${tenantId}:*`) are generated using the active `tenantId`, completely separating cached memory blocks between different business organizations.
- **Elasticsearch indexing:** Payloads indexed to the Bonsai Elasticsearch cluster include the `tenantId`. Search endpoints apply a strict keyword term filter on `tenantId` to ensure agents only retrieve fuzzy matches inside their own tenant environment.
- **RabbitMQ events:** Event dispatches contain `tenantId` parameters inside message payloads, allowing downstream consumers (like webhooks or email queues) to handle execution tasks within the proper tenant business context.

---

## ⚖️ Module Trade-offs & Decisions

### 1. Shared Database + Shared Schema (Discriminator Column) vs. Database-per-Tenant
* **Decision:** We used a single PostgreSQL database instance with a `tenantId` discriminator column on every table instead of spinning up separate databases for each tenant.
* **Pros:** Highly cost-efficient, simple migration deployment, easy maintenance of database connections, and fast onboarding of new tenants.
* **Cons:** No physical data isolation. A single query bug where a developer forgets to add the `where: { tenantId }` filter could leak Tenant B's data to Tenant A. To mitigate this risk, we:
  - Encapsulated database access inside a **strict Repository Pattern** where method signatures enforce `tenantId` as a mandatory parameter.
  - Built **automated integration tests** that specifically execute cross-tenant requests to verify query boundaries fail-closed (returning `404 Not Found`).

### 2. Header-Based Propagation vs. Session Propagation
* **Decision:** Propagating auth properties (`tenantId`) via custom headers (`x-tenant-id`) from the Edge Middleware to route handlers.
* **Pros:** Standardizes route logic. The route handler simply reads from HTTP headers, remaining independent of cookie parsing mechanisms (which enables headless API testing with bearer tokens).
* **Cons:** If headers are spoofed or external requests bypass the middleware proxy (e.g., if API ports are exposed directly), someone could inject any tenant ID. We mitigated this by running Next.js behind a gateway that restricts public access to internal ports, and ensuring headers are parsed from the validated middleware stream.
