# SaaS Helpdesk: End-to-End User Acceptance Testing (UAT) Matrix

This document defines the complete end-to-end business-oriented UAT matrix, test data configurations, security benchmarks, and detailed workflow validations for the Multi-Tenant Helpdesk SaaS platform.

---

## 1. Setup Phase: User & Organization Registration

### 1.1 Tenant Context Details
*   **Organization A (Acme Corp)**: Represents a high-throughput global manufacturing firm.
*   **Organization B (Wayne Enterprises)**: Represents a specialized defense technology enterprise.

### 1.2 User Onboarding Workflow
To validate the invitation flow, execute the following steps for each invited user:

```
[Admin Page] Invite Agent ──> [RabbitMQ Event: agent.invited] ──> [Email Sent (SMTP)] ──> [Sign-in Directly with Credentials Provided]
```

1.  **Onboard Organization A Agents**:
    *   Log in as `admin@tenant-a.com`. Navigate to the **Admin Portal > Team Directory**.
    *   Invite the following three agent email addresses:
        *   **Agent 1**: `agent1@tenant-a.com` (Role: Agent)
        *   **Agent 2**: `agent2@tenant-a.com` (Role: Agent)
        *   **Agent 3**: `agent3@tenant-a.com` (Role: Agent)
2.  **Onboard Organization B Agent**:
    *   Log in as `admin@tenant-b.com`. Navigate to the **Admin Portal > Team Directory**.
    *   Invite:
        *   **Agent B1**: `agent1@tenant-b.com` (Role: Agent)

### 1.3 Invitation Verification Checkpoints
For every invitation sent above, verify and document:
*   **Email Receipt**: Check the receiver's inbox (or SMTP logger) for the welcome mail. It should welcome the user to the team and request them to obtain credentials from their administrator.
*   **Login Success**: Validate that the agent can authenticate successfully using the credentials and receives their JWT access cookie.

---

## 2. Ticket Creation Test Data Setup

Create the following five tickets in **Organization A** exactly as defined. These will form the baseline for UAT verification:

### TK-001: Critical Database Block
*   **Created By**: Admin Org A (`admin@tenant-a.com`)
*   **Assigned To**: Agent 1 (`agent1@tenant-a.com`)
*   **Priority**: `CRITICAL`
*   **Initial Status**: `OPEN`
*   **Category**: Database / Infrastructure
*   **Description**: Production PostgreSQL database container has run out of file storage space during a bulk schema migration lock table operation. This is blocking all client-facing writes.

### TK-002: High Priority SSE Timeout
*   **Created By**: Admin Org A (`admin@tenant-a.com`)
*   **Assigned To**: Agent 2 (`agent2@tenant-a.com`)
*   **Priority**: `HIGH`
*   **Initial Status**: `OPEN`
*   **Category**: AI Integration / Streaming
*   **Description**: The Server-Sent Events (SSE) stream hangs after token 24 when calling the Groq/OpenAI client on the ticket detail dashboard. Users see truncated suggested replies.

### TK-003: Medium Priority Redis Limit
*   **Created By**: Agent 1 (`agent1@tenant-a.com`)
*   **Assigned To**: Agent 3 (`agent3@tenant-a.com`)
*   **Priority**: `MEDIUM`
*   **Initial Status**: `OPEN`
*   **Category**: Cache / Security
*   **Description**: Sliding window rate limit returns 429 Too Many Requests errors too early during concurrent user load testing. Need to check Redis sorted set ZREMRANGEBYSCORE timestamps.

### TK-004: Low Priority Unassigned Ticket
*   **Created By**: Agent 2 (`agent2@tenant-a.com`)
*   **Assigned To**: `UNASSIGNED`
*   **Priority**: `LOW`
*   **Initial Status**: `OPEN`
*   **Category**: Sockets / Real-Time
*   **Description**: Socket room updates intermittently disconnect when multiple browser tabs are open on the same ticket details endpoint.

### TK-005: High Priority Webhook Mismatch
*   **Created By**: Agent 3 (`agent3@tenant-a.com`)
*   **Assigned To**: Agent 1 (`agent1@tenant-a.com`)
*   **Priority**: `HIGH`
*   **Initial Status**: `OPEN`
*   **Category**: Webhooks / Integration
*   **Description**: Secure webhook endpoint signature checks fail when verifying headers. Check if HMAC SHA256 matches body payload buffer.

---

## 3. Email Notification Routing Matrix

Ensure notifications route precisely as defined in this matrix:

| Action | Creator Gets Email | Assignee Gets Email | Admin Gets Email | Other Agents Get Email |
| :--- | :--- | :--- | :--- | :--- |
| **User Onboarded** | No | **Yes (Welcome Message)** | No | No |
| **Ticket Created** | No | **Yes (If Assigned)** | **Yes (Tenant Admin)** | No |
| **Ticket Assigned** | No | **Yes (Assignee)** | No | No |
| **Ticket Updated** | **Yes** | **Yes (If Assigned)** | No | No |
| **Comment Added** | **Yes** | **Yes (If Assigned)** | No | No |
| **Ticket Resolved** | **Yes** | **Yes** | **Yes (Tenant Admin)** | No |
| **Ticket Closed** | **Yes** | **Yes** | **Yes (Tenant Admin)** | No |

---

## 4. End-to-End UAT Spreadsheet Matrix

> [!NOTE]
> Socket validation is only applicable on the Ticket Details page where real-time room communication is established.

| Test Case ID | Module | Scenario | Steps | Expected Result | Email Validation | Socket Validation (Ticket Details Only) | RabbitMQ Validation | Redis Validation | Pass/Fail | Remarks |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **UAT-001** | Onboarding | Invite Agent 1 to Org A | Invite `agent1@tenant-a.com` from Admin dashboard. Log in. | Agent 1 is added to Tenant A and logs in successfully. | Welcome email sent to Agent 1. | N/A (Not on detail page) | Event `agent.invited` published & processed successfully. | Team directory cache invalidated in Redis. | | |
| **UAT-002** | Creation | Create Ticket TK-001 | Log in as Admin Org A. Create Ticket TK-001 assigned to Agent 1. | Ticket created successfully. Appears on dashboard list. | Email sent to Agent 1 (Assignee) and Admin (Tenant Admin). | N/A (Not on detail page) | Event `ticket.created` published to exchange. | Ticket list cache invalidated for Tenant A. | | |
| **UAT-003** | Assignment | Assign TK-004 to Agent 2 | Log in as Admin A. Update TK-004 assignee from Unassigned to Agent 2. | Assignee changes to Agent 2. Detail screen reflects assignment. | Email notification sent to Agent 2. No email sent to Admin. | Active tabs for TK-004 update details instantly. | Event `ticket.updated` published with routing key. | Cache evicted. Next query pulls fresh DB state. | | |
| **UAT-004** | Communication | Agent 1 replies to TK-002 | Log in as Agent 1. Go to TK-002 (assigned to Agent 2). Post reply: "Checking proxy settings." | Comment is saved and displayed on detail timeline. | Email sent to Creator (Admin A) and Assignee (Agent 2). | Reply appears instantly on Agent 2's browser window. | Event `comment.created` published & processed. | Cache bypassed (direct detail update). | | |
| **UAT-005** | Lifecycle | Transition TK-001: Open -> In Progress | Log in as Agent 1. Go to TK-001 details. Update status to `IN_PROGRESS`. | Status transitions. Audit trail updates. | Email sent to Creator (Admin A). Assignee is bypassed (Agent 1 is updater). | Status badge updates to yellow "In Progress" in real time. | Event `ticket.updated` published to queue. | Cache evicted. Dashboard counts update immediately. | | |
| **UAT-006** | Lifecycle | Transition TK-001: In Progress -> Resolved | Log in as Agent 1. Go to TK-001 details. Update status to `RESOLVED`. | Status updates. Analytics resolution timestamp recorded. | Email sent to Creator (Admin A). Assignee is bypassed. | Status updates on details page instantly. | Event `ticket.updated` published. | Cache evicted. Resolved counts updated in DB. | | |
| **UAT-007** | Lifecycle | Transition TK-001: Resolved -> Closed | Log in as Admin Org A. Go to TK-001 details. Update status to `CLOSED`. | Status badge updates to gray "Closed". | Email sent to Assignee (Agent 1). Admin is bypassed (Admin is updater). | Details page updates for all users reading the ticket. | Event `ticket.updated` published. | Cache evicted. Archive metrics updated. | | |
| **UAT-008** | Cache Integrity | Redis load checks for dashboard | Log in as Admin Org A. Load Dashboard. Reload Dashboard. | First load hits DB, caches results. Second load pulls from Redis. | No email dispatched. | N/A (Not on detail page) | No RabbitMQ event. | Key `tenant:a:dashboard` read. Query time is < 5ms. | | |
| **UAT-009** | Real-Time Sync | Sockets isolation checks | Open Admin A and Agent 2 on TK-002 details. Open Admin B on TK-003 details. | Real-time comments appear on Tenant A tabs. Tenant B tab is unaffected. | No emails sent. | Socket updates broadcast only to room `ticket-2`. | No queue events. | No cache changes. | | |
| **UAT-010** | Queue Resilience | Failure retry to DLQ | Shut down email worker container. Update ticket. Start worker after 3 attempts. | Worker attempts processing, fails, retries 3 times, then pushes to DLQ. | Email sending delayed until worker restarts. | Details page updates in real time via Socket.IO. | Job retried 3 times with exponential delay, then moved to DLQ. | Cache updated normally. | | Log shows retry loops. |
| **UAT-011** | Multi-Tenancy | Workspace isolation check | Log in as Agent B1. Attempt to fetch details of TK-001 (Tenant A) via API/URL. | Request is blocked at database/query level. Returns 403 or 404. | No emails sent. | No Socket broadcasts cross namespaces. | No event published. | Tenant B cache unaffected. | | |
| **UAT-012** | Analytics | Aggregate calculations | Log in as Admin Org A. Open Analytics page. | Prism raw query execution returns correct metrics. | No emails. | N/A (Not on detail page) | No events. | Read from database using queryRaw, bypassing cache. | | |
| **UAT-013** | AI Service | Request AI Reply Suggestion | Log in as Agent 1. Open TK-001. Click "Draft Suggestion" button. | Suggested response streams down token-by-token in the suggestion drawer. | No email sent. | N/A (Client-only socket/SSE) | No queue event published. | Redis increments the hourly AI invocation usage counter. | | |
| **UAT-014** | Rate Limiting | Redis AI Rate Limit (10/hr) | Request AI suggestion 10 times. Request the 11th time within the same hour. | 11th request is blocked and returns a 429 rate limit error to the UI. | No email sent. | N/A | No queue event published. | Redis sorted set (ZSET) rate limit window evaluated and block enforced. | | |
| **UAT-015** | Search Sync | Elasticsearch Index Sync | Create ticket TK-001. Search for "bulk schema migration" in search bar. | Search results return ticket TK-001 instantly. Autocomplete works. | No email sent. | N/A | Event `ticket.created`/`ticket.updated` consumed by search worker. | Search worker synchronizes document to ES index cluster. | | |
| **UAT-016** | Webhooks | Webhook Dispatch & Signature | Register webhook URL and secret key in Admin Portal. Add comment to ticket. | Webhook server receives POST request containing header `X-Helpdesk-Signature`. HMAC SHA256 matches body. | Email sent to ticket followers normally. | Active detail tabs refresh timeline. | Event `reply.created` consumed by webhook worker. | PostgreSQL logs successful webhook delivery logs. | | |

---

## 5. Verification Checkpoints

### 5.1 Analytics Calculations (Tenant A Baseline)
After completing UAT steps `UAT-001` through `UAT-016`, your analytics dashboard counts for **Tenant A** must match:
*   **Total Open Tickets**: `2` (TK-003, TK-005)
*   **Total In Progress Tickets**: `1` (TK-002)
*   **Total Resolved Tickets**: `1` (TK-004 resolved/closed verification)
*   **Total Closed Tickets**: `1` (TK-001 closed)
*   **Top Agents by Resolution**:
    1.  `agent1@tenant-a.com` (1 Ticket Resolved)
    2.  `agent2@tenant-a.com` (1 Ticket Resolved)
*   **Tenant B Isolation**: Tenant B's metrics (2 Resolved, 1 Open) must be completely absent from Tenant A's dashboard.

### 5.2 RabbitMQ Output Log Signature
When events process, ensure your terminal logs print this exact signature pattern:
```bash
[RabbitMQ] Published event: ticket.created
Received event "ticket.created" (Attempt 1)
Email sent to: agent1@tenant-a.com
Email delivered successfully. Message ID: <...>
```
