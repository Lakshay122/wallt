# Email Notifications (Nodemailer)

This document describes the design and templates of the system's background email dispatch system.

---

## Technical Files & Scoping Context

- **Consumer Worker Script:** [emailWorker.ts](file:///Users/lakshaybansal/code/personal/wallt_assingment/server/workers/emailWorker.ts) — Background consumer that listens to RabbitMQ events and dispatches emails.

---

## Email Transporter Configuration

The worker supports two operation modes for maximum flexibility:

1. **Production Mode (Real SMTP Server):**
   If environment variables (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`) are configured, the worker connects to the external SMTP server (e.g., Gmail SMTP on port 587 using STARTTLS).
2. **Development/Fallback Mode (Ethereal test accounts):**
   If no SMTP credentials are provided, Nodemailer dynamically creates an **Ethereal Test Account**. This allows developers to inspect sent emails using generated preview URLs without configuring real credentials.

---

## E-mail Notification Scenarios & Templates

Emails are dispatched asynchronously by the worker when it consumes specific RabbitMQ routing key events:

### 1. Ticket Creation Notification (`ticket.created`)
- **Recipient:** The ticket creator.
- **Subject:** `[Helpdesk] Ticket Received: <Ticket Title>`
- **Template:** Confirms the ticket has been successfully registered and displays the unique ticket ID, priority level, and description.

### 2. Assignment Notification (`ticket.created`)
- **Recipient:** The assigned support agent (if different from the creator).
- **Subject:** `[Helpdesk] New Ticket Assigned: <Ticket Title>`
- **Template:** Informs the agent of the new assignment and links them to review the SLA guidelines.

### 3. Ticket Property Change Alert (`ticket.updated`)
- **Recipient:** The assigned agent.
- **Subject:** `[Helpdesk] Ticket Updated: <Ticket Title>`
- **Template:** Alerts the assignee about changes to ticket priority or status (e.g. status changed from `OPEN` to `IN_PROGRESS`).
- **Self-Notification Bypass:** To prevent spamming, the worker compares the `updatedById` header of the event payload with the recipient's user ID. If the assignee is the one who updated the ticket, the email notification is silently skipped.

### 4. Agent Workspace Welcome Invitation (`agent.invited`)
- **Recipient:** The newly onboarded agent.
- **Subject:** `[Helpdesk] Workspace Invitation`
- **Template:** Welcomes the agent to the workspace and instructs them to request their login credentials from their Tenant Administrator.

---

## 🔗 Connection with Other Modules

- **RabbitMQ Message Queue:** Employs the `emailWorker.ts` consumer to ingest ticket and invitation events bound to `helpdesk.notification_queue` queue.
- **Postgres Database:** Queries user email profiles during event parsing and updates `FailedNotification` logs when transporter connections fail.
- **Agent Management Routes:** Emits the `agent.invited` event payload on agent creation to notify workers.

---

## ⚖️ Module Trade-offs & Decisions

### 1. Ethereal Email Fallback vs. Throwing Errors (Fail-Safe)
* **Decision:** We fall back to creating temporary Ethereal SMTP test accounts when no host env variables are defined, rather than failing the process boot.
* **Pros:** Ideal developer experience (DX). New developers can run the entire docker-compose stack and test the worker flow without inputting private SMTP keys. It logs the preview URL directly to the console.
* **Cons:** If production credentials are accidentally omitted, emails will still route to Ethereal previews instead of sending real customer notifications. We resolved this by throwing warning flags in logs.

### 2. Self-Notification Bypass logic vs. Blanket Alerts
* **Decision:** Filtering out notifications when the user initiating the action matches the recipient.
* **Pros:** Greatly improves user experience. Agents updating ticket properties (e.g. marking as `RESOLVED`) do not get spam emails in their inbox for actions they just performed.
* **Cons:** Slightly increases processing checks inside the worker script.
