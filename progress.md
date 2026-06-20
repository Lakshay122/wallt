# Helpdesk SaaS - Development Progress & Architecture

This file tracks the current state of implementation, directory structure, files, and the technical approaches used for each component.

---

## Key Architectural Assumptions & Design Decisions

> [!NOTE]
> **Authorization & Scoping Strategy:**
> * **Tenant Isolation (`tenantId`):** Strictly enforced at the database query level on every operation. Users from Tenant A are completely blocked from accessing Tenant B resources.
> * **Ownership & Assignment (`userId`):** Ticket assignment represents operational ownership and reporting only. It is not used for authorization boundaries. Any agent belonging to the same tenant can view, reply to, update, or change the status of any ticket inside their tenant's workspace.
> * **Roles (`ADMIN` vs `AGENT`):**
>   * `ADMIN`: Access to tenant configurations, user onboarding, and analytics dashboards.
>   * `AGENT`: Access to ticket queues, status transitions, and AI suggestions.
> 
> *Ensure this is documented in the final README during Phase 8.*

---

## Directory Structure

```
wallt_assignment/
├── client/                 # Next.js 16+ Frontend & Next.js API Routes
│   ├── src/
│   │   ├── app/
│   │   │   ├── api/
│   │   │   │   ├── auth/   # JWT Signup, Login, Refresh, Logout routes
│   │   │   │   ├── tickets/# CRUD APIs, replies, search, and AI suggestion endpoints
│   │   │   │   └── users/  # Agent Management APIs (create, list, update, status, delete)
│   │   ├── lib/
│   │   │   ├── auth.ts     # JWT utilities
│   │   │   ├── elasticsearch.ts # Elasticsearch client singleton & index setup (v7)
│   │   │   ├── prisma.ts   # Prisma client utility
│   │   │   ├── rabbitmq.ts # RabbitMQ Event Publisher
│   │   │   ├── redis.ts    # Redis client utility
│   │   │   ├── repositories/ # Database Access repositories (user.repository.ts)
│   │   │   ├── services/   # Business logic services (user.service.ts)
│   │   │   └── validators/ # Input validators (user.validator.ts)
│   │   └── middleware.ts   # Tenant validation & JWT verification middleware
│   ├── prisma/             # Prisma database schema and migrations
│   │   ├── schema.prisma
│   │   └── seed.ts
│   ├── package.json
│   └── tsconfig.json
├── server/                 # Standalone Node/TS server for Workers & Sockets
│   ├── src/
│   │   └── index.ts        # Socket.IO WebSocket server
│   ├── config/
│   │   └── elasticsearch.ts # Elasticsearch configuration helper for backend workers
│   ├── workers/
│   │   ├── emailWorker.ts  # RabbitMQ consumer (emails / notifications)
│   │   ├── searchWorker.ts # RabbitMQ consumer (Elasticsearch ticket sync)
│   │   └── webhookWorker.ts # RabbitMQ consumer (webhooks dispatcher)
│   ├── package.json
│   └── tsconfig.json
├── docker-compose.yml      # Orchestrates Postgres, Redis, RabbitMQ, Client & Server
├── package.json            # Root workspace configurations
├── api_test_flow.md        # Step-by-step API test flow guide
├── caching.md              # Redis caching layer details
└── progress.md             # This progress and architecture description
```

---

## Deep-Dive on Implemented Components

Here is the exact state of what has been implemented, including file paths, logic details, and database structures:

### 1. Workspace Configuration & Project Structure
* **Configuration:** Root [package.json](file:///Users/lakshaybansal/code/personal/wallt_assingment/package.json) sets up npm workspaces for `client` and `server`. Includes utility scripts (`dev:client`, `dev:server`, `prisma:migrate`, `prisma:generate`, etc.) for managing the monorepo from the root workspace.
* **Environment variables:** Formulated in [.env](file:///Users/lakshaybansal/code/personal/wallt_assingment/.env) and [client/.env](file:///Users/lakshaybansal/code/personal/wallt_assingment/client/.env) mapping database parameters to a live Neon Postgres cloud instance.

### 2. Database Design & Migration (Neon PostgreSQL)
* **Schema Configuration:** Implemented in [schema.prisma](file:///Users/lakshaybansal/code/personal/wallt_assingment/client/prisma/schema.prisma) with three core models:
  * `User`: Stores user identifiers (`id`, `email`, `name`, `createdAt`), linked to created tickets and replies.
  * `Ticket`: Stores ticket contents (`id`, `title`, `description`, `status` [default: `OPEN`], `priority` [default: `LOW`], `userId` [optional], `createdAt`, `updatedAt`).
  * `TicketReply`: Thread replies for support tickets (`id`, `content`, `ticketId`, `userId` [optional], `createdAt`).
* **Migrations Applied:**
  * `init`: Created the tables for `User` and `Ticket`.
  * `add_ticket_replies`: Added the `TicketReply` table along with relation references.
* **Global Client Helper:** Created [prisma.ts](file:///Users/lakshaybansal/code/personal/wallt_assingment/client/src/lib/prisma.ts) to prevent multiple database client instantiations during development hot reloads.

### 3. Multi-Tenant User Authentication & Route Middleware
* **Database Schema & Migrations:** Modified [schema.prisma](file:///Users/lakshaybansal/code/personal/wallt_assingment/client/prisma/schema.prisma) to introduce a `Tenant` model (featuring `description` for business guidelines and `type` for industry categories) and a `Role` (`ADMIN`, `AGENT`) enum, and added relation mapping to link `User`, `Ticket`, and `TicketReply` to the `Tenant`. Applied the migration successfully.
* **JWT Helpers:** Created [auth.ts](file:///Users/lakshaybansal/code/personal/wallt_assingment/client/src/lib/auth.ts) using the edge-compatible `jose` library to sign and verify access tokens (15m) and refresh tokens (7d).
* **Auth APIs:** Created `/api/auth/signup` (to register a new tenant and admin user), `/api/auth/login`, and `/api/auth/logout` handlers using secure HttpOnly, SameSite cookies for credential storage.
* **Request Middleware:** Created [middleware.ts](file:///Users/lakshaybansal/code/personal/wallt_assingment/client/src/middleware.ts) to intercept `/api/tickets/:path*` requests, verify tokens, auto-refresh expired access tokens using the refresh token, and propagate `tenantId`, `userId`, and `role` to route handlers via headers.

### 4. Ticket CRUD REST APIs (With Tenant Isolation)
* **GET `/api/tickets`** ([route.ts](file:///Users/lakshaybansal/code/personal/wallt_assingment/client/src/app/api/tickets/route.ts)):
  * Scopes queries strictly by `tenantId` extracted from request headers.
  * Implements query parameter filters for `status`, `priority`, and `assignedToId` under the scoped tenant.
  * Cursor-based pagination.
* **POST `/api/tickets`** ([route.ts](file:///Users/lakshaybansal/code/personal/wallt_assingment/client/src/app/api/tickets/route.ts)):
  * Verifies that the assigned `assignedToId` belongs to the creator's tenant. Creates ticket under the active `tenantId`, capturing the authenticated author as `createdById`.
* **GET `/api/tickets/[id]`** & **PATCH `/api/tickets/[id]`** ([route.ts](file:///Users/lakshaybansal/code/personal/wallt_assingment/client/src/app/api/tickets/%5Bid%5D/route.ts)):
  * Retrieves or modifies individual ticket records scoped strictly by `tenantId` to enforce absolute database-level data isolation. Resolves the `creator` and `assignedTo` agent profiles.
* **POST `/api/tickets/[id]/replies`** ([route.ts](file:///Users/lakshaybansal/code/personal/wallt_assingment/client/src/app/api/tickets/%5Bid%5D/replies/route.ts)):
  * Verifies ticket tenancy and saves the reply with the authenticated `userId` and `tenantId`.

### 5. Redis Caching & Eviction Engine
* **Connection Lifecycle:** Implemented a reusable connection singleton in [redis.ts](file:///Users/lakshaybansal/code/personal/wallt_assingment/client/src/lib/redis.ts) configured to pull `REDIS_URL` parameters.
* **Deterministic Query Caching:** Integrated caching into `GET /api/tickets` to save listing response objects utilizing filter-specific keys (e.g. `tenant:${tenantId}:tickets:list:${status}:${priority}:${assignedToId}:${limit}:${cursor}`) with a 1-hour expiration TTL.
* **Single Ticket Details Caching:** Integrated caching for single ticket detail fetches (`GET /api/tickets/[id]`) using keys like `tenant:${tenantId}:ticket:${id}` with a 1-hour TTL, vastly speeding up detail page loads.
* **Safe Invalidation:** Created a non-blocking scan invalidation routine. Any mutating call (`POST /api/tickets`, `PATCH /api/tickets/[id]`, or `POST /api/tickets/[id]/replies`) triggers `invalidateTenantTicketsCache(tenantId)` (to clear list caches) and `invalidateSingleTicketCache(tenantId, ticketId)` (to clear single ticket details caches), performing a clean `SCAN` of the tenant's cache namespace and evicting all query variations.

### 6. Agent Management APIs (ADMIN Only)
* **Objective:** Enable tenant administrators to securely onboard, configure, toggle status, and delete agents under their tenant workspace.
* **Architecture Design & Authorization Fixes:**
  * **Validators (`user.validator.ts`):** Enforces request body compliance using Zod schemas.
  * **Repositories (`user.repository.ts`):** Encapsulates direct database calls (includes custom Prisma transaction for deletions).
  * **Services (`user.service.ts`):** Orchestrates validation, hashes agent passwords using `bcryptjs`, restricts access to `ADMIN` users, and ensures tenant scoping.
  * **Authorization Guarding:** Resolved a privilege escalation bug where `/api/users` cached outputs were served before verifying roles. Placed role validations before cache queries.
  * **Team List Fetch permissions:** Allowed both `ADMIN` and `AGENT` roles to view the team members directory list (`GET /api/users`) to populate the Ticket Assignee dropdown menu. Kept all mutation operations (`POST`, `PATCH`, `DELETE`) strictly guarded for `ADMIN` users only.
* **Routes Configured:**
  * `POST /api/users`: Onboards a new agent (forces role to `AGENT`, scopes to the admin's `tenantId`, hashes passwords, returns user without password).
  * `GET /api/users`: Returns all users inside the active `tenantId` (excludes passwords, orders by creation date descending).
  * `PATCH /api/users/[id]`: Updates details like name/email (prevents updating role or `tenantId`).
  * `PATCH /api/users/[id]/status`: Enables/disables an agent. Disabled agents are barred from logging in (`isActive === false` triggers `403 Forbidden`).
  * `DELETE /api/users/[id]`: Removes agents permanently (sets any assigned ticket relations to `null` to preserve history, prohibits deleting ADMINs).
  * `GET /api/admin/failed-notifications`: Fetches quarantined DLQ/failed notifications from PostgreSQL, strictly scoped by `tenantId` for multi-tenant isolation, with cursor-based pagination and validation checks.

### 7. RabbitMQ Message Queue & Consumer Worker
* **Objective:** Decouple critical database mutations (tickets, agent onboardings) from downstream tasks (sending email alerts) using a resilient event-driven queue.
* **Component Layers:**
  * **Publisher (`rabbitmq.ts`):** Established a singleton connection pool using the edge-compatible `amqplib` wrapper, exporting `publishEvent(routingKey, payload)`.
  * **Consumer (`server/workers/emailWorker.ts`):** Standalone Node background worker declaring exchanges, binding queues (`ticket.*`, `agent.invited`), and consuming events.
* **Event Scoping & Triggers:**
  * `ticket.created` (on `POST /api/tickets` success): Triggers new ticket notification.
  * `ticket.updated` (on `PATCH /api/tickets/[id]` success): Triggers status/priority modification alert.
  * `agent.invited` (on `POST /api/users` success): Triggers welcome email to the newly onboarded agent (instructs them to request temporary credentials from their tenant admin).
* **Resiliency & Fault Tolerance (Retry Policy / DLQ):**
  * Implemented an **Exponential Backoff Retry** mechanism (Max retries: 3) utilizing custom header checks.
  * Configured a **Dead Letter Exchange (DLX)** and **Dead Letter Queue (DLQ)** (`helpdesk.notification_queue.dlq`) to automatically quarantine failed notifications after retry exhaustion.
  * Saved failed notifications to the `FailedNotification` table in PostgreSQL under a scoped `tenantId` with the failed reason, so that tenant administrators can audit delivery failures.
  * **Automatic Connection Recovery**: Integrated `'close'` and `'error'` handlers on the AMQP client connection in all workers (`emailWorker.ts`, `webhookWorker.ts`, and `searchWorker.ts`). When heartbeat timeouts occur or network sockets close, the workers automatically schedule connection retry loops after 5 seconds instead of crashing.

### 8. Multi-LLM AI Suggestion Engine (Saga / Fallback Pattern)
* **Objective:** Deliver a resilient agent suggestion assistant that streams generated responses in real-time.
* **Component Architecture:**
  * **Integration Clients (`ai.ts`):** Initializes client wrappers for Google GenAI (`@google/genai`) and Groq (`groq-sdk`), and sets up a fetch caller interface for Nvidia NIM endpoint.
  * **Fallback Chain (`getAiSuggestionStream`):** Sequentially chains providers (**Gemini 2.5 Flash** ➔ **Groq Llama 3.3 70B** ➔ **Nvidia DeepSeek R1**). If a provider fails to generate, the generator logs the error and gracefully switches to the next fallback without crashing the client request.
  * **SSE API Handler (`/api/tickets/[id]/suggest`):** Authenticates the session, validates that the ticket belongs to the user's `tenantId`, builds context using the ticket details and recent replies, and returns a Server-Sent Events (SSE) `text/event-stream` body.

### 9. UI Development, Layout Polish & API Integration (Tailwind CSS + ShadCN UI)
* **Objective:** Design a premium, highly responsive user interface using Tailwind CSS and ShadCN Radix UI component blocks, integrating client-side state with Next.js multi-tenant API endpoints.
* **Security & Polish Updates:**
  * **Edge Route Guards:** Secured `/admin` path via middleware (`client/src/middleware.ts`) by redirecting non-admin users to `/dashboard` immediately to prevent page flashes.
  * **Header Navigation Roles:** Conditionally rendered "Admin Room" link in the top header only for `ADMIN` users across both `/dashboard` and `/tickets/[id]`.
  * **Timeline Loading State:** Resolved layout blinking of message alignments by rendering a loading indicator in the Conversation Timeline thread until `currentUser` metadata is fully resolved.
  * **Layout Enhancements:** Added uniform spacing after password input fields in login and signup views, and synchronized the width and height of the Radix select field (`!h-11 w-full`) to align perfectly with adjacent text inputs on the signup screen.
  * **Interactive Pointer Cursors:** Added global base CSS pointer declarations for `button`, `a`, `select`, select triggers, and tab triggers to ensure standard hover behaviors across the workspace.
* **Views Configured (`client/src/app/`):**
  * **Landing Page (`/`):** A beautiful marketing splash hero linking to login/signup.
  * **Signup (`/signup`):** Workspace and administrator creation page with validation.
  * **Login (`/login`):** Credentials sign-in utilizing HttpOnly secure cookie exchange.
  * **Dashboard (`/dashboard`):** Unified tenant ticket workspace showing ticket status lists, filter controls (Status, Priority, Assignee), and a "Create Ticket" modal trigger. Supports cursor-based load-more pagination.
  * **Ticket Thread Room (`/tickets/[id]`):** Displays ticket context, replies timeline, properties update sidebar, and an interactive **AI Suggestion Panel** that consumes the SSE stream in real time.
  * **Admin Room (`/admin`):** Exposes a secure tabbed portal (Admin only) for Agent Onboarding, Status Toggles, Permanent Account Deletion, and delivery failure DLQ logs.

## What was Changed in Phase 9, 10 & 11 (Real-Time Updates, AI Suggestions & SSE Streaming)

1. **Standalone Socket.IO Server (`server/index.ts`):**
   * Programmed an Express HTTP + Socket.IO server running on port `3001` (configured via `SOCKET_PORT`).
   * **Connection Handshake Authentication:** Verifies incoming sockets using JWT tokens passed inside handshake headers (`auth.token` or queries). Identifies `userId`, `role`, and `tenantId`.
   * **Ticket Room Isolation:** Connections join room channels (`ticket:${ticketId}`).
   * **RabbitMQ Broadcaster:** Subscribes to the RabbitMQ events exchange (`ticket.*` and `reply.created`) on an exclusive queue. Upon message retrieval, it broadcasts `ticket:updated` or `reply:created` events to matching Socket.IO rooms.
2. **Frontend Client Integration:**
   * Configured React hooks to initialize `socket.io-client` on mount.
   * **Real-time Active Presence Widget:** Client requests `/api/users/me` to fetch their token, connects to the websocket server, and joins the ticket room. The widget shows all active users in real-time, correctly handling active sessions and displaying "(you)".
   * **Ticket Thread Synchronization:** Listens for incoming replies and ticket updates on the active ticket room. Instantly appends messages to the conversation timeline and refreshes priority/status chips.
3. **Multi-LLM AI Suggestion Engine & SSE Streaming:**
   * **Fallback Chain:** Sequentially chains providers (**Gemini 2.5 Flash** ➔ **Groq Llama 3.3 70B** ➔ **Nvidia DeepSeek R1**). If a provider fails to generate, the generator switches to the next fallback.
   * **SSE API Stream endpoint:** Exposes `GET /api/tickets/[id]/suggest` streaming responses back using Next.js `ReadableStream` with `text/event-stream` headers.

---

### 10. AI Rate Limiting (Phase 12)
* **Objective:** Prevent abuse of AI suggestion streams.
* **Implementation:**
  * Implemented a sliding window rate-limiter using Redis Sorted Sets (`ZSET`).
  * Restricts each tenant to a maximum of **10 AI suggest requests per hour**.
  * Auto-expires window items and handles Redis failures gracefully.
  * Added UI headers indicating usage (e.g. `2/10 used`).

### 11. Analytics Dashboard API & Charts (Phase 13)
* **Objective:** Provide operational insights to tenant administrators.
* **Implementation:**
  * Created a secure admin-only endpoint `/api/analytics` performing aggregations via Prisma `$queryRaw`.
  * Computes total open/in-progress/resolved ticket count, average resolution time in hours, daily ticket creation volume (last 30 days), and top 3 resolving agents.
  * Integrated a premium Recharts line chart and dashboard grid in the Admin console.

### 12. Webhooks Delivery Engine (Phase 16 - Bonus)
* **Objective:** Push real-time ticket events to tenant-defined target URLs.
* **Implementation:**
  * Created database schema mapping `WebhookConfig` containing endpoint URLs and HMAC signing secrets.
  * Implemented secure GET & POST endpoint under `/api/admin/webhooks`.
  * Built background consumer `server/workers/webhookWorker.ts` subscribing to RabbitMQ events (`ticket.*`, `reply.created`), signing payloads with HMAC-SHA256, and POSTing to the target URL with exponential retries.
  * Designed settings panel under the Admin console.

### 13. Advanced Elasticsearch Search & Autocomplete (Phase 16 - COMPLETED)
* **Objective:** Power fast, multi-tenant scoped full-text fuzzy queries, real-time sync workers, and auto-complete dropdown search suggestions.
* **Implementation:**
  * **SDK Client Connection (v7.13.0):** Created [elasticsearch.ts](file:///Users/lakshaybansal/code/personal/wallt_assingment/client/src/lib/elasticsearch.ts) & `server/config/elasticsearch.ts` configured with the `@elastic/elasticsearch` v7 SDK client targeting a hosted cloud Bonsai cluster, bypassing newer version checks.
  - **Index Mapping:** Formulated `tickets` index mapping defining custom `edge_ngram` prefix tokenizers for autocomplete searches, strict keyword filters on `tenantId` for isolation boundaries, and `nested` structures for replies.
  - **Asynchronous Sync Worker:** Created `server/workers/searchWorker.ts` registering custom Painless script updates triggered via RabbitMQ events (`ticket.created`, `ticket.updated`, `reply.created`).
  - **Scoped API Endpoint:** Exposed `/api/tickets/search` validating tenant boundaries with database SQL-level query fallback (fail-open strategy) if the Elasticsearch client is unconfigured.
  - **Frontend UI Autocomplete:** Integrated debounced text queries and floating select suggest dropdown cards on the Dashboard page.

### 14. Automated Testing (Phase 14 - COMPLETED)
* **Objective:** Ensure backend reliability and regression protection.
* **Implementation:**
  * Implemented **14 automated integration and unit tests** using Vitest.
  * Covers token verification, middleware route guards, ticket query pagination, Redis rate limit sliding windows, and event publishing interfaces.

### 15. Containerization (Phase 15 - COMPLETED)
* **Objective:** Package the entire application stack for single-command deployments.
* **Implementation:**
  * Dockerized the Next.js frontend app (`client`), the Node/TypeScript WebSocket server (`server`), and the background workers (`server/workers`).
  * Structured multi-container deployment in root `docker-compose.yml` orchestrating PostgreSQL, Redis, RabbitMQ, Client, Server, and Worker services with health checks and volume mounts.

### 16. UAT Testing & Pagination Polish (COMPLETED)
* **Objective:** Verify operational user flows and polish edge behaviors.
* **Implementation:**
  * Created a comprehensive manual UAT spreadsheet (`manual_testing_spreadsheet.md`) containing 16 detailed end-to-end verification cases.
  * Resolved a critical cursor pagination edge case where the 11th ticket was skipped due to incorrect `nextCursor` calculations (now properly returns the 10th ticket's ID as the cursor).
  * Cleared and polished self-notification loops in email workers and cleaned markdown syntax rendering for streamed AI suggestions.

---

## Detailed Roadmap & Future Pending Phases

Here is what is currently scheduled for future production phases:

### Phase 17 — Production Deployment & Cloud Provisioning
* **Objective:** Deploy client and server components to production hosting.
* **Tasks:**
  * Deploy the Next.js client to Vercel/Amplify.
  * Deploy worker, database, cache, queues, and websocket servers to cloud hosting providers (Railway, Render, AWS, or GCP).


