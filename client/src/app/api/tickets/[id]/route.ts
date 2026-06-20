import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { redis, invalidateTenantTicketsCache, invalidateSingleTicketCache } from '@/lib/redis';
import { publishEvent } from '@/lib/rabbitmq';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/tickets/[id] - Get Ticket Details with tenant isolation
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const tenantId = req.headers.get('x-tenant-id');
    if (!tenantId) {
      return NextResponse.json({ error: 'Unauthorized: Tenant missing' }, { status: 401 });
    }

    const { id } = await params;
    const cacheKey = `tenant:${tenantId}:ticket:${id}`;

    // Try fetching from Redis
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return NextResponse.json(JSON.parse(cached));
      }
    } catch (cacheError) {
      console.error('Redis GET ticket cache error:', cacheError);
    }

    const ticket = await prisma.ticket.findFirst({
      where: { id, tenantId },
      include: {
        assignedTo: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
        creator: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
        replies: {
          orderBy: {
            createdAt: 'asc',
          },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
                role: true,
              },
            },
          },
        },
      },
    });

    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
    }

    // Cache the successful result in Redis with 1-hour TTL
    try {
      await redis.set(cacheKey, JSON.stringify(ticket), 'EX', 3600);
    } catch (cacheError) {
      console.error('Redis SET ticket cache error:', cacheError);
    }

    return NextResponse.json(ticket);
  } catch (error: any) {
    console.error('Error fetching ticket:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

// PATCH /api/tickets/[id] - Update Ticket with tenant isolation and cache invalidation
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const tenantId = req.headers.get('x-tenant-id');
    const updatedById = req.headers.get('x-user-id') || '';
    if (!tenantId) {
      return NextResponse.json({ error: 'Unauthorized: Tenant missing' }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json();
    const { title, description, priority, status, assignedToId } = body;

    // Verify ticket exists and belongs to current tenant
    const ticketExists = await prisma.ticket.findFirst({
      where: { id, tenantId },
    });
    if (!ticketExists) {
      return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
    }

    // Verify assigned user if assignedToId is changing
    if (assignedToId) {
      const userExists = await prisma.user.findUnique({
        where: { id: assignedToId },
      });
      if (!userExists || userExists.tenantId !== tenantId) {
        return NextResponse.json({ error: 'Assigned user not found in this tenant.' }, { status: 404 });
      }
    }

    const updatedTicket = await prisma.ticket.update({
      where: { id },
      data: {
        title: title !== undefined ? title : undefined,
        description: description !== undefined ? description : undefined,
        priority: priority !== undefined ? priority : undefined,
        status: status !== undefined ? status : undefined,
        assignedToId: assignedToId !== undefined ? (assignedToId === '' || assignedToId === null ? null : assignedToId) : undefined,
      },
      include: {
        assignedTo: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
        creator: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });

    // Invalidate cached lists for this tenant and single ticket cache
    await invalidateTenantTicketsCache(tenantId);
    await invalidateSingleTicketCache(tenantId, id);

    // Publish ticket.updated event to RabbitMQ
    await publishEvent('ticket.updated', {
      ticketId: updatedTicket.id,
      title: updatedTicket.title,
      description: updatedTicket.description,
      priority: updatedTicket.priority,
      status: updatedTicket.status,
      assignedToId: updatedTicket.assignedToId,
      createdById: updatedTicket.createdById,
      tenantId: updatedTicket.tenantId,
      updatedAt: updatedTicket.updatedAt,
      updatedById,
    });

    return NextResponse.json(updatedTicket);
  } catch (error: any) {
    console.error('Error updating ticket:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
