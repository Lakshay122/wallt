# Helpdesk SaaS - Deep-Dive Documentation Index

To review this multi-tenant helpdesk architecture effectively, it is recommended to read these documents in the following sequence:

---

## 📖 Recommended Reading Sequence

### 1️⃣ Core Foundation & Multi-Tenancy Boundary
* **Step 1: [PostgreSQL Schema & Prisma ORM](file:///Users/lakshaybansal/code/personal/wallt_assingment/docs/database_infra.md)** (`database_infra.md`): The data model ERD, constraints, and relationships.
* **Step 2: [Strict Tenant Scoping & Isolation](file:///Users/lakshaybansal/code/personal/wallt_assingment/docs/tenant_isolation.md)** (`tenant_isolation.md`): How the multi-tenant row-level query boundaries are securely isolated.

### 2️⃣ Authentication & Access Controls
* **Step 3: [Multi-Tenant Authentication (JWT + Refresh Tokens)](file:///Users/lakshaybansal/code/personal/wallt_assingment/docs/auth.md)** (`auth.md`): Stateless session tokens, edge validation, and cookie security.
* **Step 4: [Role-Based Access Control & Zod Input Validation](file:///Users/lakshaybansal/code/personal/wallt_assingment/docs/rbac_validation.md)** (`rbac_validation.md`): Enforcing authorization rules (`ADMIN` vs. `AGENT`) and request payload validation.

### 3️⃣ Ticket Lifecycle & Data Querying
* **Step 5: [Ticket CRUD, Filtering & Pagination](file:///Users/lakshaybansal/code/personal/wallt_assingment/docs/ticket_crud_filtering.md)** (`ticket_crud_filtering.md`): Database search queries, filters, and cursor-based pagination.
* **Step 6: [Redis Caching & Sliding Window Rate Limiting](file:///Users/lakshaybansal/code/personal/wallt_assingment/docs/redis_caching.md)** (`redis_caching.md`): Caching lists and detail feeds, SCAN invalidation, and rate limits.

### 4️⃣ Real-Time Synchronization & AI suggestions
* **Step 7: [Socket.IO Real-time Presence & Updates](file:///Users/lakshaybansal/code/personal/wallt_assingment/docs/socket_io.md)** (`socket_io.md`): Websocket topology and active viewing presence widgets.
* **Step 8: [AI suggestions & SSE Streaming](file:///Users/lakshaybansal/code/personal/wallt_assingment/docs/ai_suggestions.md)** (`ai_suggestions.md`): SSE streaming endpoints and multi-LLM resilient fallback engines.
* **Step 9: [Elasticsearch Full-Text Search & Autocomplete](file:///Users/lakshaybansal/code/personal/wallt_assingment/docs/elasticsearch.md)** (`elasticsearch.md`): Custom tokenizers, real-time index synchronization, and database fallback.

### 5️⃣ Background Queues & Integrations
* **Step 10: [RabbitMQ Message Broker & Consumers](file:///Users/lakshaybansal/code/personal/wallt_assingment/docs/rabbitmq.md)** (`rabbitmq.md`): Decoupled queues, retries, and Dead Letter Queue (DLQ) strategy.
* **Step 11: [SMTP E-mail Worker](file:///Users/lakshaybansal/code/personal/wallt_assingment/docs/email_notifications.md)** (`email_notifications.md`): Notification workers and Ethereal preview fallback.
* **Step 12: [Webhooks Delivery Engine](file:///Users/lakshaybansal/code/personal/wallt_assingment/docs/webhooks.md)** (`webhooks.md`): Payloads signature verification using HMAC-SHA256.
* **Step 13: [Analytics Dashboard & Raw Aggregations](file:///Users/lakshaybansal/code/personal/wallt_assingment/docs/analytics.md)** (`analytics.md`): Raw query aggregations showing support operational KPIs.

---

## ⚖️ Design Decisions
* **Step 14: [Architectural Trade-offs & Design Decisions](file:///Users/lakshaybansal/code/personal/wallt_assingment/docs/architecture_tradeoffs.md)** (`architecture_tradeoffs.md`): Comprehensive analysis of workspace structures, event consistency, and scoping compromises.
