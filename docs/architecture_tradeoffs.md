# Architecture, Design Decisions & Trade-offs

This document details the architectural decisions, constraints, and trade-offs made during development.

---

## 1. Monorepo vs. Separated Projects Cleanup

### Decision:
Initially, the project was configured with npm workspaces (a monorepo structure) sharing a root `node_modules` folder. We transitioned this structure to have independent, localized `node_modules` folders inside the `client/` and `server/` subfolders respectively, while keeping execution scripts centralized at the root.

### Trade-offs:
- **Pros:**
  - **Isolation:** The Next.js frontend and the standalone workers/websockets server run on independent runtime package dependencies, preventing build version clashes (e.g. Prisma CLI/Client discrepancies).
  - **Deployment Simplicity:** Both packages can be built, zipped, or containerized independently without requiring the root context or workspaces path matching.
- **Cons:**
  - **Disk Space:** Restructured packages duplicate standard dependencies (like `typescript`, `ts-node`, `dotenv`), resulting in a larger local disk space footprint.

---

## 2. Asynchronous Event-Driven Architecture (RabbitMQ Queue)

### Decision:
Critical database mutations (ticket creations, updates, new replies, agent onboarding) publish lightweight payloads into a RabbitMQ exchange (`helpdesk.events`). Standalone background consumer processes handle downstream side-effects (SMTP email dispatches, webhook POST dispatches, Elasticsearch synchronization) asynchronously.

### Trade-offs:
- **Pros:**
  - **Low Latency:** API requests finish instantly because expensive HTTP/network calls (like sending emails or connecting to third-party endpoints) are deferred.
  - **High Fault Tolerance:** If an SMTP server or Elasticsearch cluster goes offline temporarily, messages are queued, retried with exponential backoff, or quarantined in a Dead Letter Queue (DLQ) for later retrieval rather than failing user requests.
- **Cons:**
  - **Eventual Consistency:** Search index states or email alerts do not reflect changes instantly.
  - **Infrastructure Complexity:** The setup requires a running RabbitMQ instance.

---

## 3. Database Scoped Tenant Isolation vs. Schema-per-Tenant

### Decision:
We implemented **Shared Database, Shared Schema** multi-tenancy. Every model (User, Ticket, TicketReply, WebhookConfig) contains a `tenantId` column, and every query is filtered by this column at runtime.

### Trade-offs:
- **Pros:**
  - **Operational Simplicity:** Database migrations are applied once to a single database schema, vastly reducing DevOps overhead.
  - **Resource Efficiency:** One database instance scales easily across multiple tenants, lowering cloud costs.
  - **Risk of Leaks:** A missing `where: { tenantId }` filter in a database query could expose data from one tenant to another. To mitigate this risk, we:
    - Encapsulated database access inside a **strict Repository Pattern** (e.g. [user.repository.ts](file:///Users/lakshaybansal/code/personal/wallt_assingment/client/src/lib/repositories/user.repository.ts)) where method signatures enforce `tenantId` as a mandatory parameter.
    - Set up Next.js Edge Middleware to securely resolve and inject validated `x-tenant-id` headers directly from the cryptographic JWT session payload.
    - Implemented **automated integration tests** that specifically perform cross-tenant API requests to verify the database query boundaries fail-closed (returning `404 Not Found` or `401 Unauthorized`).

---

## 4. Fail-Open Cache & Elasticsearch Fallbacks

### Decision:
If the Redis cache or Elasticsearch cluster is down, the APIs fail-open and fall back to direct PostgreSQL queries.

### Trade-offs:
- **Pros:**
  - **High Availability:** The application remains functional and continues to serve search results and ticket details even during infrastructure outages.
- **Cons:**
  - **Performance Hit:** Outages cause direct load on the PostgreSQL database, which can degrade database response times under heavy traffic.
