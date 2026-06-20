# Codebase Architecture & File-by-File Execution Flow

This document serves as a file-by-file navigation map to guide you through the codebase flow, from request interception to database writes and asynchronous events.

---

## 🗺️ Execution Flow (Step-by-Step)

When a client makes a request (e.g. to create or retrieve tickets), the request flows through the following layers:

### 1️⃣ Edge Request Interception & Tenant Scoping
* **[middleware.ts](file:///Users/lakshaybansal/code/personal/wallt_assingment/client/src/middleware.ts):** Checks cookies for JWT `accessToken`/`refreshToken`. Decodes the token, extracts user roles and `tenantId`, and forwards them as custom HTTP headers (`x-tenant-id`, `x-user-id`, `x-user-role`) to downstream API route handlers. Blocks non-admin users attempting to load the `/admin` path.

### 2️⃣ API Entry Point (Route Handlers)
* **[api/tickets/route.ts](file:///Users/lakshaybansal/code/personal/wallt_assingment/client/src/app/api/tickets/route.ts):** Receives HTTP request, extracts headers, and handles:
  * **GET:** Checks Redis cache (dynamic filter keyspace). If cache misses, queries PostgreSQL via Prisma with strict `where: { tenantId }` constraints and cursor-based pagination logic, then caches the result in Redis.
  * **POST:** Valdates assignee workspace scoping and creates the ticket under the authenticated user's `tenantId`.

### 3️⃣ Business Logic & Validation Services (Example: Agent Onboarding)
* **[validators/user.validator.ts](file:///Users/lakshaybansal/code/personal/wallt_assingment/client/src/lib/validators/user.validator.ts):** Zod schema validations for client payloads.
* **[services/user.service.ts](file:///Users/lakshaybansal/code/personal/wallt_assingment/client/src/lib/services/user.service.ts):** Evaluates administrator role checks, hashes credentials via `bcryptjs`, and coordinates db operations.
* **[repositories/user.repository.ts](file:///Users/lakshaybansal/code/personal/wallt_assingment/client/src/lib/repositories/user.repository.ts):** Executes database queries using the database client.
* **[lib/prisma.ts](file:///Users/lakshaybansal/code/personal/wallt_assingment/client/src/lib/prisma.ts):** Global database connection client singleton.

### 4️⃣ Asynchronous Background Processing (RabbitMQ Integration)
* **[lib/rabbitmq.ts](file:///Users/lakshaybansal/code/personal/wallt_assingment/client/src/lib/rabbitmq.ts):** AMQP connection publisher. Mutating routes publish events (like `ticket.created`, `ticket.updated`, `agent.invited`) to the `helpdesk.events` Topic Exchange.
* **[server/workers/runAll.ts](file:///Users/lakshaybansal/code/personal/wallt_assingment/server/workers/runAll.ts):** Background worker runner that spins up the AMQP queues and event listeners:
  * **[server/workers/emailWorker.ts](file:///Users/lakshaybansal/code/personal/wallt_assingment/server/workers/emailWorker.ts):** Consumes events and dispatches SMTP notifications (using Nodemailer). Implements self-notification checks.
  * **[server/workers/searchWorker.ts](file:///Users/lakshaybansal/code/personal/wallt_assingment/server/workers/searchWorker.ts):** Indexes tickets to the cloud Elasticsearch index. Uses Painless scripts to append comments in nested reply arrays.
  * **[server/workers/webhookWorker.ts](file:///Users/lakshaybansal/code/personal/wallt_assingment/server/workers/webhookWorker.ts):** Performs HMAC-SHA256 signing of the body payload and dispatches webhooks to tenant-configured URLs.

### 5️⃣ Real-time Synchronization (Websockets)
* **[server/index.ts](file:///Users/lakshaybansal/server/index.ts):** Standalone Socket.IO server running on port `3001`. Connects to RabbitMQ, listens for ticket events, parses target rooms (`ticket:${ticketId}`), and emits socket broadcasts to refresh timeline states and track viewing agent active presence.

---

## 📁 Key Directories to Review

```
wallt_assignment/
├── client/                     # Next.js App Workspace
│   ├── src/app/api/            # REST API Endpoint handlers (Authentication, Tickets, Users)
│   ├── src/lib/                # Shared repositories, services, and client singletons
│   └── prisma/                 # Relational Database Schema & Seeder
├── server/                     # Standalone WebSocket & Worker Workspace
│   ├── workers/                # AMQP consumers (Email, Search index sync, Webhook dispatches)
│   └── index.ts                # Socket.IO Gateway server
└── docs/                       # Individual deep-dive architectural documents (See docs/index.md for the recommended reading sequence)
```
