# Analytics Dashboard & Prisma Raw SQL Aggregations ($queryRaw)

This document describes how support metrics, daily trends, and performance KPIs are aggregated and rendered inside the secure Admin Console.

---

## Technical Files & Scoping Context

- **Analytics API Endpoint:** [route.ts](file:///Users/lakshaybansal/code/personal/wallt_assingment/client/src/app/api/analytics/route.ts) — Secure route that runs raw PostgreSQL aggregation queries.
- **Admin View Component:** [page.tsx](file:///Users/lakshaybansal/code/personal/wallt_assingment/client/src/app/admin/page.tsx) — Analytics Dashboard interface containing KPI layout cards and Recharts interactive graphs.

---

## Database Aggregations via Raw SQL ($queryRaw)

Prisma's standard query API does not support advanced grouping, interval date parsing, and interval arithmetic across support tickets. To perform these aggregations efficiently under strict tenant scoping, the system uses Prisma `$queryRaw`:

### 1. Daily Ticket Volume (Last 30 Days)
This query generates a list of ticket counts grouped by day, ensuring that dates with zero tickets still return in the result set for charting.
```sql
SELECT 
  DATE_TRUNC('day', "createdAt")::date as date, 
  COUNT(*)::int as count 
FROM "Ticket" 
WHERE "tenantId" = $1 
  AND "createdAt" >= NOW() - INTERVAL '30 days' 
GROUP BY DATE_TRUNC('day', "createdAt") 
ORDER BY date ASC;
```

### 2. Average Resolution Time
This query calculates the average resolution time in hours for all resolved or closed tickets, using interval calculations to determine the time difference between creation and update.
```sql
SELECT 
  COALESCE(AVG(EXTRACT(EPOCH FROM ("updatedAt" - "createdAt")) / 3600), 0)::float as avg_hours
FROM "Ticket"
WHERE "tenantId" = $1 
  AND "status" IN ('RESOLVED', 'CLOSED');
```

---

## The Recharts Chart Integration

The frontend renders these daily counts using **Recharts** inside the dashboard:
- **ResponsiveContainer:** Scales the line chart responsively across desktop, tablet, and mobile views.
- **LineChart & Smooth Line:** Configured with a `monotone` interpolation type to draw a smooth line showing daily ticket trends.
- **Custom Tooltip:** Displays structured hover counts matching the aesthetic styling.
- **Grids & Legends:** Uses subtle colors to align with the black-and-white theme.

---

## 🔗 Connection with Other Modules

- **Authentication Middleware:** Access is restricted to `ADMIN` roles. The router parses the `x-user-role` header to enforce this barrier before launching raw queries.
- **Database Schema Models:** Aggregates values directly from the `Ticket` table and links resolving agent names by joining the `User` table.
- **Client Admin Dashboard:** React elements query the `/api/analytics` endpoint and populate KPI cards and graphs during page load.

---

## ⚖️ Module Trade-offs & Decisions

### 1. Raw PostgreSQL SQL Queries ($queryRaw) vs. Prisma ORM GroupBy API
* **Decision:** We used raw SQL queries via `$queryRaw` rather than native Prisma ORM grouping methods.
* **Pros:** Highly expressive. Prisma's standard `groupBy` lacks support for advanced date truncation (`DATE_TRUNC`) and interval arithmetic operations (such as calculating average hours between `createdAt` and `updatedAt`). Raw SQL lets us compute these averages directly on the database engine.
* **Cons:** Harder to port to other databases (e.g., if migrating from PostgreSQL to MySQL, SQL dialects differ). Since the project is standardized on PostgreSQL, this is an acceptable trade-off.

### 2. Real-time Aggregation vs. Cached Analytics Tables
* **Decision:** Generating aggregates dynamically on request rather than maintaining a separate stats table updated by workers.
* **Pros:** Simpler code; database metrics are always 100% accurate and up-to-date.
* **Cons:** Slows down as ticket tables grow (requires full table scans on index matches). Since this is an admin dashboard queried infrequently, dynamic calculation is much simpler than handling aggregate write drifts.
