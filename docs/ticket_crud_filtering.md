# Ticket CRUD, Filters & Cursor-Based Pagination

This document describes how ticket management, pagination, and list filter queries are structured and executed.

---

## Technical Files & Scoping Context

- **Main Listing & Creator Router:** [route.ts](file:///Users/lakshaybansal/code/personal/wallt_assingment/client/src/app/api/tickets/route.ts) — Scopes list filters and cursor pagination.
- **Details & Mutators Route:** [route.ts](file:///Users/lakshaybansal/code/personal/wallt_assingment/client/src/app/api/tickets/%5Bid%5D/route.ts) — Retrieves details and modifies ticket properties.
- **Replies Routing:** [route.ts](file:///Users/lakshaybansal/code/personal/wallt_assingment/client/src/app/api/tickets/%5Bid%5D/replies/route.ts) — Lists thread replies.

---

## Cursor-Based Pagination Details

To prevent data drift and offset inconsistencies in real-time listings, the application leverages cursor-based pagination rather than offset-based pagination:

- **Parameters:**
  - `limit`: The quantity of tickets to load in a single query (default: 10).
  - `cursor`: A unique, chronological reference point indicating where to resume reading (corresponds to the ticket's database UUID).
- **Execution Flow:**
  - First Page: Request contains no cursor parameter. The query retrieves the top $N$ tickets sorted descending by creation date.
  - Subsequent Pages: Request passes the last ticket ID from the current page as `cursor`. The query fetches records created after the cursor ticket.

```typescript
const limit = parseInt(searchParams.get('limit') || '10', 10);
const cursor = searchParams.get('cursor');

const tickets = await prisma.ticket.findMany({
  where: { tenantId },
  take: limit + 1, // Fetch N+1 to check if there is a next page
  skip: cursor ? 1 : 0, // Skip the cursor element itself
  cursor: cursor ? { id: cursor } : undefined,
  orderBy: { createdAt: 'desc' }
});

// Pagination calculation
let nextCursor: string | undefined = undefined;
if (tickets.length > limit) {
  tickets.pop(); // Remove the extra item
  nextCursor = tickets[tickets.length - 1]?.id; // 10th item's ID becomes next cursor
}
```

---

## Integrated Filters

Ticket list requests support combining queries to drill down into logs:
- **`status`**: Filter by status state (`OPEN`, `IN_PROGRESS`, `RESOLVED`, `CLOSED`).
- **`priority`**: Filter by ticket urgency (`LOW`, `MEDIUM`, `HIGH`, `URGENT`).
- **`assignedToId`**: Filter by assigned support agent profile.

All queries evaluate and build filter sets dynamically to preserve performance:
```typescript
const filter: any = { tenantId };
if (status) filter.status = status;
if (priority) filter.priority = priority;
if (assignedToId) filter.assignedToId = assignedToId;
```

---

## 🔗 Connection with Other Modules

- **Redis Caching:** Filters and cursor values are serialized directly into the cache key. Mutations (creation, updates, replies) perform namespace invalidations to purge these cached lists.
- **RabbitMQ events:** When a ticket is created (`POST /api/tickets`) or updated (`PATCH /api/tickets/[id]`), a message is published to the `helpdesk.events` exchange. This notifies background workers to send emails, sync search indexes, and push webhooks.
- **Websockets (Real-Time Updates):** When a ticket property changes, the standalone socket server receives a RabbitMQ event and broadcasts the new state (`ticket:updated`) directly to client browsers on the matching ticket room.
- **Dashboard UI:** The React dashboard page polls these endpoints, maintaining local infinite scroll lists that append loaded pages based on the returned `nextCursor`.

---

## ⚖️ Module Trade-offs & Decisions

### 1. Cursor-Based Pagination vs. Offset-Based (Page-Number) Pagination
* **Decision:** We implemented cursor-based pagination (`cursor: { id }` + `skip: 1`) instead of offset-based pagination (`skip: offset`).
* **Pros:** Highly consistent in real-time interfaces. If a new ticket is created while an agent is scrolling, offset pagination would shift pages and show duplicate items. Cursor pagination maintains a stable anchor point. It is also much faster on large tables since databases can index cursors (SQL execution time does not increase with page depth).
* **Cons:** Inability to skip pages. The user cannot jump directly to page 5; they must load pages 1, 2, 3, and 4 sequentially. We chose this since helpdesk feeds are typically browsed as a continuous feed.

### 2. Over-Fetching (Limit + 1) vs. Separate Count Queries
* **Decision:** Fetched `limit + 1` records instead of running a separate `count()` query to verify if more items exist.
* **Pros:** Saves database roundtrips. We can determine if there's a next page in a single query by checking if the array length exceeds the limit.
* **Cons:** Fetches one extra record over the network, which is discarded at the server layer. Since a single ticket payload is negligible, this is a highly optimal trade-off.
