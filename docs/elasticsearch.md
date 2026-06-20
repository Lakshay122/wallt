# Elasticsearch Search & Autocomplete

This document describes the design, implementation, and indexing lifecycle of the full-text search and prefix autocomplete engine powered by Elasticsearch.

---

## Technical Files & Scoping Context

- **Client Configuration (Frontend API):** [elasticsearch.ts](file:///Users/lakshaybansal/code/personal/wallt_assingment/client/src/lib/elasticsearch.ts) — Elasticsearch client settings and index mapping initializer.
- **Client Configuration (Backend Worker):** [elasticsearch.ts](file:///Users/lakshaybansal/code/personal/wallt_assingment/server/config/elasticsearch.ts) — Configures index and mappings for workers.
- **Search Sync Worker:** [searchWorker.ts](file:///Users/lakshaybansal/code/personal/wallt_assingment/server/workers/searchWorker.ts) — Event-driven sync worker updating ticket indexes and replies.
- **Search API Routing:** [route.ts](file:///Users/lakshaybansal/code/personal/wallt_assingment/client/src/app/api/tickets/search/route.ts) — Full-text search and completion suggester route.

---

## Index Configuration & Edge N-gram Mappings

The `tickets` index is initialized dynamically at startup with custom analyzers:

- **Autocomplete Analyzer:** Uses an `edge_ngram` tokenizer (min length: 2, max length: 20) with a `lowercase` filter. When a user creates a ticket with the title "Connection Error", the tokenizer indexes fragments like `co`, `con`, `conn`, etc., enabling instant autocomplete suggestions.
- **Search Analyzer:** Standard tokenizer with a lowercase filter to match input queries without tokenization anomalies.
- **Tenant Scope:** The `tenantId` property is mapped as a `keyword` to enforce strict query filtering boundaries.
- **Nested Replies:** Replies are mapped using the `nested` type to isolate replies from one ticket thread crossing over with queries in another ticket thread.

---

## Elasticsearch Sync Worker

The background worker consumes `helpdesk.search_queue` events to keep index listings updated in real-time:
- **`ticket.created`:** Indexes a new document.
- **`ticket.updated`:** Executes a partial document update to sync status, assignee, and priority.
- **`reply.created`:** Appends new reply comments into the ticket's `replies` nested array using a **Painless Update Script**:
  ```javascript
  if (ctx._source.replies == null) { ctx._source.replies = []; }
  if (!ctx._source.replies.stream().anyMatch(r -> r.replyId == params.newReply.replyId)) {
    ctx._source.replies.add(params.newReply);
  }
  ```

---

## Scoped Query Enforcement & Database Fallback

1. **Strict Tenant Boundaries:**
   All search requests append a mandatory filter checking the user's `tenantId` header to restrict queries:
   ```typescript
   must: [
     { term: { tenantId } },
     { match: { title: { query, fuzziness: 'AUTO' } } }
   ]
   ```

2. **SQL-Based Database Fallback:**
   If the Elasticsearch client is unconfigured or goes offline, the endpoint falls back gracefully to a Prisma database query using SQL wildcards, ensuring the application remains functional:
   ```typescript
   if (!esClient) {
     const dbTickets = await prisma.ticket.findMany({
       where: {
         tenantId,
         OR: [
           { title: { contains: query, mode: 'insensitive' } },
           { description: { contains: query, mode: 'insensitive' } }
         ]
       }
     });
     return NextResponse.json({ success: true, tickets: dbTickets, source: 'database_fallback' });
   }
   ```

---

## 🔗 Connection with Other Modules

- **RabbitMQ Message Queue:** Employs the `searchWorker.ts` consumer to ingest ticket events published by API handlers asynchronously, decoupling search database updates from direct REST requests.
- **Next.js Search API Route:** Directly reads search matching queries from client browsers and issues fuzzy searches against the Bonsai cloud index.
- **Postgres Database:** Used as a fallback database source if Elasticsearch times out or faces connection errors.

---

## ⚖️ Module Trade-offs & Decisions

### 1. Edge-NGram Tokenization vs. Standard Full-Text Query
* **Decision:** We defined custom `edge_ngram` analyzers on index mapping instead of regular wildcard queries.
* **Pros:** Enables fast, real-time autocomplete suggestions as the user types, matching search queries at $O(1)$ query speeds.
* **Cons:** Increases index storage footprints on disk because a single word is split into multiple sub-tokens. Since our ticket volume is moderate, storage optimization is subordinate to search speed.

### 2. Fail-Open Database Fallback vs. Fail-Closed Error Handling
* **Decision:** Fall back to raw Postgres SQL wildcard matches if the Elasticsearch client is disconnected.
* **Pros:** High application availability. Users can still search for tickets even if the external search cluster goes offline.
* **Cons:** Postgres wildcard matches (`LIKE %search%`) execute slow table scans under heavy loads and lack fuzzy relevance sorting. However, this is treated as a transient backup layer.

### 3. Painless Update Scripts vs. Full Document Reindexing
* **Decision:** Used Elasticsearch Painless scripts to push new replies into existing ticket document arrays.
* **Pros:** Low network bandwidth; we only send the new reply payload instead of pulling the entire ticket, appending the string, and putting it back.
* **Cons:** Painless scripting carries minor CPU compiling overhead on the search cluster during the first run.
