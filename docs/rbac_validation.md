# Role-Based Access Control (RBAC) & Zod Input Validation

This document describes the validation rules, data schemas, and role-based authorization guards implemented throughout the multi-tenant SaaS application.

---

## Technical Files & Scoping Context

- **Zod Request Validators:** [user.validator.ts](file:///Users/lakshaybansal/code/personal/wallt_assingment/client/src/lib/validators/user.validator.ts) — Enforces structural schemas for invitations and modifications.
- **Admin Page Router Guard:** [middleware.ts](file:///Users/lakshaybansal/code/personal/wallt_assingment/client/src/middleware.ts) — Redirects non-admin users at the edge.
- **Agent CRUD Services Guard:** [user.service.ts](file:///Users/lakshaybansal/code/personal/wallt_assingment/client/src/lib/services/user.service.ts) — Business logic guards checking roles.

---

## Role-Based Access Control (RBAC)

The system supports two user roles defined in the database schema:
1. **`ADMIN`:** Full access to tenant configuration, user onboarding, disabling/deleting agents, webhooks setup, and the analytics dashboard.
2. **`AGENT`:** Access to the support queue, updating ticket assignments, posting replies, and receiving AI draft suggestions.

### Enforcement Mechanisms:
- **Edge Route Protection:**
  The Next.js Middleware intercepts visits to `/admin` or `/admin/:path*` pages. If a non-admin session is detected (`role !== 'ADMIN'`), the request is redirected to `/dashboard` immediately:
  ```typescript
  if (req.nextUrl.pathname.startsWith('/admin') && role !== 'ADMIN') {
    return NextResponse.redirect(new URL('/dashboard', req.url));
  }
  ```
- **Service Layer Scoping:**
  Business logic methods check permissions explicitly before executing changes:
  ```typescript
  if (actorRole !== 'ADMIN') {
    throw new Error('Forbidden: Admin access required');
  }
  ```

---

## Input Validation (Zod)

To prevent database injection and guarantee structural integrity, all mutating APIs validate request payloads using **Zod schemas**:

### Schema Definitions (Agent Invitation & Modifications):
```typescript
export const createUserSchema = z.object({
  email: z.string().email('Invalid email address format'),
  name: z.string().min(2, 'Name must be at least 2 characters long'),
  password: z.string().min(6, 'Password must be at least 6 characters long'),
});
```

When a request is received, the JSON payload is parsed. If validation fails, Zod throws detailed errors that are returned to the client as a `400 Bad Request` with a structured list of field-specific validation warnings.

---

## 🔗 Connection with Other Modules

- **Authentication Middleware:** RBAC checks rely directly on the `x-user-role` header injected by the middleware. If the header is modified or missing, the APIs immediately fail closed.
- **Agent Management Services:** Service files (e.g., [user.service.ts](file:///Users/lakshaybansal/code/personal/wallt_assingment/client/src/lib/services/user.service.ts)) check validation schemas before delegating writes to [user.repository.ts](file:///Users/lakshaybansal/code/personal/wallt_assingment/client/src/lib/repositories/user.repository.ts).
- **Client Frontend Forms:** Next.js pages reuse user validation constraints to display real-time client-side error states before sending payloads over the network.

---

## ⚖️ Module Trade-offs & Decisions

### 1. In-Memory Validation (Zod) vs. Database Check Constraints
* **Decision:** We used Zod schema validation at the application service entry point rather than database constraints alone.
* **Pros:** Returns instant, developer-friendly validation details to the client without executing database connections, avoiding connection pool starvation and unnecessary db CPU cycles.
* **Cons:** Schemas must be kept in sync with Prisma schema changes.

### 2. Dual-Layer RBAC Enforcement (Edge + Service) vs. Controller-Level Guards
* **Decision:** Implemented RBAC checks both in Edge Middleware (for client view redirects) and API Service layers.
* **Pros:** Double safety; UI page loads are fast (blocked at Edge), and direct API curl queries are securely guarded even if the client-side router is bypassed.
* **Cons:** Slightly duplicates rule definitions, requiring developers to keep both the middleware route lists and service-level rules in sync.
