import { describe, it, expect, vi, beforeEach } from 'vitest';
import nodemailer from 'nodemailer';

// Mock amqplib globally
vi.mock('amqplib', () => {
  const mockEmailChannel = {
    assertExchange: vi.fn(),
    assertQueue: vi.fn(),
    bindQueue: vi.fn(),
    consume: vi.fn((queue, cb) => {
      (global as any).emailConsumeCallback = cb;
    }),
    ack: vi.fn(),
    nack: vi.fn(),
    publish: vi.fn(),
  };

  const mockWebhookChannel = {
    assertExchange: vi.fn(),
    assertQueue: vi.fn(),
    bindQueue: vi.fn(),
    consume: vi.fn((queue, cb) => {
      (global as any).webhookConsumeCallback = cb;
    }),
    ack: vi.fn(),
    nack: vi.fn(),
    publish: vi.fn(),
  };

  let callCount = 0;
  const mockConnection = {
    createChannel: vi.fn().mockImplementation(async () => {
      callCount++;
      // First call is emailWorker, second is webhookWorker
      return callCount === 1 ? mockEmailChannel : mockWebhookChannel;
    }),
    on: vi.fn(),
  };

  return {
    default: {
      connect: vi.fn().mockImplementation(async () => mockConnection),
    },
    mockEmailChannel,
    mockWebhookChannel,
  };
});

// 2. Mock nodemailer
vi.mock('nodemailer', () => {
  const sendMailMock = vi.fn().mockResolvedValue({ messageId: 'msg-123' });
  return {
    default: {
      createTransport: vi.fn().mockReturnValue({
        sendMail: sendMailMock,
      }),
      createTestAccount: vi.fn().mockResolvedValue({
        smtp: { host: 'smtp.test', port: 587, secure: false },
        user: 'test-user',
        pass: 'test-pass',
      }),
      getTestMessageUrl: vi.fn().mockReturnValue('http://ethereal.email/preview'),
    },
  };
});

// 3. Mock Prisma Client
vi.mock('@prisma/client', () => {
  const mockPrismaInstance = {
    user: {
      findUnique: vi.fn(),
    },
    webhookConfig: {
      findUnique: vi.fn(),
    },
    failedNotification: {
      create: vi.fn(),
    },
  };
  return {
    PrismaClient: class {
      constructor() {
        return mockPrismaInstance;
      }
    },
  };
});

// 4. Mock global fetch for webhooks
const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  status: 200,
});
global.fetch = mockFetch;

import amqp, { mockEmailChannel, mockWebhookChannel } from 'amqplib';

import { PrismaClient } from '@prisma/client';
const prismaMock = new PrismaClient() as any;

// Import the workers to trigger their initialization & mock registration
import '../workers/emailWorker';
import '../workers/webhookWorker';

describe('📢 Background Consumer Workers Stack', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('📬 Nodemailer Email Notification Worker', () => {
    it('should consume agent.invited event and send a welcome email', async () => {
      expect((global as any).emailConsumeCallback).toBeDefined();

      const payload = {
        name: 'New Agent',
        email: 'newagent@helpdesk.com',
        role: 'AGENT',
        tenantId: 'tenant-123',
      };

      const mockMsg = {
        fields: { routingKey: 'agent.invited' },
        content: Buffer.from(JSON.stringify(payload)),
        properties: { headers: {} },
      } as any;

      // Invoke consumer callback
      await (global as any).emailConsumeCallback!(mockMsg);

      // Verify email was sent via transport mock
      const mockTransporter = nodemailer.createTransport();
      expect(mockTransporter.sendMail).toHaveBeenCalled();
      const mailArgs = (mockTransporter.sendMail as any).mock.calls[0][0];
      expect(mailArgs.to).toBe('newagent@helpdesk.com');
      expect(mailArgs.subject).toContain('Workspace Invitation');
      expect(mailArgs.html).toContain('New Agent');
      expect(mockEmailChannel.ack).toHaveBeenCalledWith(mockMsg);
    });

    it('should consume ticket.created and notify ticket assignee', async () => {
      // Mock assignee and creator fetch
      prismaMock.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
        if (where.id === 'user-creator') {
          return { id: 'user-creator', name: 'Creator User', email: 'creator@helpdesk.com' };
        }
        if (where.id === 'agent-123') {
          return { id: 'agent-123', name: 'Support Agent', email: 'agent@helpdesk.com' };
        }
        return null;
      });

      const payload = {
        ticketId: 'ticket-123',
        title: 'Printer Broken',
        priority: 'MEDIUM',
        description: 'Office printer is jamming',
        assignedToId: 'agent-123',
        createdById: 'user-creator',
        tenantId: 'tenant-123',
      };

      const mockMsg = {
        fields: { routingKey: 'ticket.created' },
        content: Buffer.from(JSON.stringify(payload)),
        properties: { headers: {} },
      } as any;

      await (global as any).emailConsumeCallback!(mockMsg);

      // Should check user database
      expect(prismaMock.user.findUnique).toHaveBeenCalled();
      // Should send email to assignee
      const mockTransporter = nodemailer.createTransport();
      expect(mockTransporter.sendMail).toHaveBeenCalled();
      const mailArgs = (mockTransporter.sendMail as any).mock.calls.find(c => c[0].to === 'agent@helpdesk.com')![0];
      expect(mailArgs.subject).toContain('New Ticket Assigned');
      expect(mockEmailChannel.ack).toHaveBeenCalledWith(mockMsg);
    });

    it('should consume ticket.updated and handle self-notification bypass for assignee and creator', async () => {
      // Mock assignee and creator fetch
      prismaMock.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
        if (where.id === 'user-creator') {
          return { id: 'user-creator', name: 'Creator User', email: 'creator@helpdesk.com' };
        }
        if (where.id === 'agent-123') {
          return { id: 'agent-123', name: 'Support Agent', email: 'agent@helpdesk.com' };
        }
        return null;
      });

      const payload = {
        ticketId: 'ticket-123',
        title: 'SSE Timeout',
        priority: 'HIGH',
        status: 'IN_PROGRESS',
        assignedToId: 'agent-123',
        createdById: 'user-creator',
        tenantId: 'tenant-123',
        updatedById: 'agent-123', // Assignee is updating (should bypass assignee, notify creator)
      };

      const mockMsg = {
        fields: { routingKey: 'ticket.updated' },
        content: Buffer.from(JSON.stringify(payload)),
        properties: { headers: {} },
      } as any;

      await (global as any).emailConsumeCallback!(mockMsg);

      const mockTransporter = nodemailer.createTransport();
      // Should NOT notify assignee since they made the update
      const assigneeMail = (mockTransporter.sendMail as any).mock.calls.find(c => c[0].to === 'agent@helpdesk.com');
      expect(assigneeMail).toBeUndefined();

      // Should notify creator since they didn't make the update
      const creatorMail = (mockTransporter.sendMail as any).mock.calls.find(c => c[0].to === 'creator@helpdesk.com');
      expect(creatorMail).toBeDefined();
      expect(creatorMail[0].subject).toContain('Ticket Updated');
      expect(mockEmailChannel.ack).toHaveBeenCalledWith(mockMsg);
    });
  });

  describe('🔗 Webhook Event Dispatcher Worker', () => {
    it('should calculate HMAC SHA-256 signature and post payload', async () => {
      const payload = {
        ticketId: 'ticket-123',
        tenantId: 'tenant-123',
        title: 'API Outage',
      };

      const mockMsg = {
        fields: { routingKey: 'ticket.created' },
        content: Buffer.from(JSON.stringify(payload)),
        properties: { headers: {} },
      } as any;

      // Mock webhook database config
      prismaMock.webhookConfig.findUnique.mockResolvedValue({
        url: 'https://client-api.com/callback',
        secret: 'webhook-signing-secret-key',
        isActive: true,
      });

      await (global as any).webhookConsumeCallback!(mockMsg);

      // Verify POST call parameters
      expect(mockFetch).toHaveBeenCalled();
      const [url, requestInit] = mockFetch.mock.calls[0];
      expect(url).toBe('https://client-api.com/callback');
      expect(requestInit.method).toBe('POST');
      expect(requestInit.headers['Content-Type']).toBe('application/json');
      expect(requestInit.headers['X-Helpdesk-Signature']).toBeDefined();
      expect(requestInit.headers['X-Helpdesk-Signature']).toContain('sha256=');
      expect(mockWebhookChannel.ack).toHaveBeenCalledWith(mockMsg);
    });

    it('should log failed notifications to Postgres once retries are exhausted', async () => {
      const payload = {
        ticketId: 'ticket-123',
        tenantId: 'tenant-123',
        title: 'API Outage',
      };

      // Mock message showing 3rd failed attempt
      const mockMsg = {
        fields: { routingKey: 'ticket.created' },
        content: Buffer.from(JSON.stringify(payload)),
        properties: { 
          headers: { 'x-retry-count': 3 } // Retries exhausted
        },
      } as any;

      // Force webhook delivery to fail
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
      });

      prismaMock.webhookConfig.findUnique.mockResolvedValue({
        url: 'https://client-api.com/callback',
        secret: 'webhook-signing-secret-key',
        isActive: true,
      });

      await (global as any).webhookConsumeCallback!(mockMsg);

      // Should NOT acknowledge but nack (dead-letter queue)
      expect(mockWebhookChannel.nack).toHaveBeenCalledWith(mockMsg, false, false);
    });
  });
});
