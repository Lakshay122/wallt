import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET as getTicketHandler, PATCH as patchTicketHandler } from '@/app/api/tickets/[id]/route';
import { POST as createTicketHandler } from '@/app/api/tickets/route';
import { GET as checkAiUsageHandler } from '@/app/api/tickets/ai-usage/route';
import { NextRequest } from 'next/server';

// 1. Mock Prisma Client
vi.mock('@/lib/prisma', () => {
  return {
    prisma: {
      ticket: {
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      user: {
        findUnique: vi.fn(),
      },
    },
  };
});

// 2. Mock Redis Client Singleton & helpers
vi.mock('@/lib/redis', () => {
  return {
    redis: {
      get: vi.fn(),
      set: vi.fn(),
      zremrangebyscore: vi.fn(),
      zcard: vi.fn(),
      zadd: vi.fn(),
      expire: vi.fn(),
    },
    invalidateTenantTicketsCache: vi.fn(),
    invalidateSingleTicketCache: vi.fn(),
    getAiSuggestCount: vi.fn().mockImplementation(async () => 5), // Mock count
  };
});

// 3. Mock RabbitMQ Publisher
vi.mock('@/lib/rabbitmq', () => {
  return {
    publishEvent: vi.fn(),
  };
});

import { prisma as prismaMock } from '@/lib/prisma';
import { publishEvent as publishEventMock } from '@/lib/rabbitmq';
import { redis as redisMock } from '@/lib/redis';

describe('🎫 Support Ticket CRUD & Scoped Enforcements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/tickets/[id] (Tenant Isolation)', () => {
    it('should return 401 if x-tenant-id header is missing', async () => {
      const req = new NextRequest('http://localhost/api/tickets/ticket-123', {
        method: 'GET',
      });

      const res = await getTicketHandler(req, { params: Promise.resolve({ id: 'ticket-123' }) });
      const data = await res.json();

      expect(res.status).toBe(401);
      expect(data.error).toContain('Tenant missing');
    });

    it('should query ticket by id AND tenantId, return 404 if not found', async () => {
      // Redis returns null (cache miss)
      (redisMock.get as any).mockResolvedValue(null);
      // Prisma returns null (ticket does not exist under Tenant A)
      (prismaMock.ticket.findFirst as any).mockResolvedValue(null);

      const req = new NextRequest('http://localhost/api/tickets/ticket-123', {
        method: 'GET',
        headers: {
          'x-tenant-id': 'tenant-A',
        },
      });

      const res = await getTicketHandler(req, { params: Promise.resolve({ id: 'ticket-123' }) });
      const data = await res.json();

      expect(res.status).toBe(404);
      expect(data.error).toBe('Ticket not found.');

      // Assert database query enforces tenant isolation
      expect(prismaMock.ticket.findFirst).toHaveBeenCalledWith({
        where: { id: 'ticket-123', tenantId: 'tenant-A' },
        include: expect.any(Object),
      });
    });

    it('should serve cached details from Redis if present', async () => {
      const cachedTicket = { id: 'ticket-123', title: 'Cached Ticket', tenantId: 'tenant-A' };
      (redisMock.get as any).mockResolvedValue(JSON.stringify(cachedTicket));

      const req = new NextRequest('http://localhost/api/tickets/ticket-123', {
        method: 'GET',
        headers: {
          'x-tenant-id': 'tenant-A',
        },
      });

      const res = await getTicketHandler(req, { params: Promise.resolve({ id: 'ticket-123' }) });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.title).toBe('Cached Ticket');
      // Should bypass database query when cache hits
      expect(prismaMock.ticket.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/tickets (CRUD & RabbitMQ)', () => {
    it('should save new ticket and publish ticket.created event', async () => {
      const mockTicket = {
        id: 'ticket-new',
        title: 'Network Timeout',
        description: 'Connection drops repeatedly',
        priority: 'HIGH',
        status: 'OPEN',
        tenantId: 'tenant-A',
        createdById: 'user-agent',
        createdAt: new Date().toISOString(),
      };

      (prismaMock.ticket.create as any).mockResolvedValue(mockTicket);

      const req = new NextRequest('http://localhost/api/tickets', {
        method: 'POST',
        headers: {
          'x-tenant-id': 'tenant-A',
          'x-user-id': 'user-agent',
        },
        body: JSON.stringify({
          title: 'Network Timeout',
          description: 'Connection drops repeatedly',
          priority: 'HIGH',
        }),
      });

      const res = await createTicketHandler(req);
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.title).toBe('Network Timeout');

      // Assert event was dispatched to RabbitMQ
      expect(publishEventMock).toHaveBeenCalledWith('ticket.created', expect.objectContaining({
        ticketId: 'ticket-new',
        title: 'Network Timeout',
        tenantId: 'tenant-A',
      }));
    });
  });

  describe('GET /api/tickets/ai-usage (Rate Limiter)', () => {
    it('should fetch rolling hourly request count', async () => {
      const req = new NextRequest('http://localhost/api/tickets/ai-usage', {
        method: 'GET',
        headers: {
          'x-tenant-id': 'tenant-A',
        },
      });

      const res = await checkAiUsageHandler(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.count).toBe(5);
    });
  });
});
