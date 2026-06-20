import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { redis, invalidateTenantTicketsCache } from '@/lib/redis';
import { publishEvent } from '@/lib/rabbitmq';

// GET /api/tickets - Get Ticket List with filters, cursor-based pagination, tenant isolation and Redis caching
export async function GET(req: NextRequest) {
  try {
    const tenantId = req.headers.get('x-tenant-id');
    if (!tenantId) {
      return NextResponse.json({ error: 'Unauthorized: Tenant missing' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);

    // Filters
    const status = searchParams.get('status') || '';
    const priority = searchParams.get('priority') || '';
    const assignedToId = searchParams.get('assignedToId') || '';

    // Pagination
    const limit = parseInt(searchParams.get('limit') || '10', 10);
    const cursor = searchParams.get('cursor') || '';

    // Construct cache key
    const cacheKey = `tenant:${tenantId}:tickets:list:${status}:${priority}:${assignedToId}:${limit}:${cursor}`;

    // Try fetching from Redis
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return NextResponse.json(JSON.parse(cached));
      }
    } catch (cacheError) {
      console.error('Redis GET error:', cacheError);
    }

    const where: any = {
      tenantId: tenantId,
    };
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (assignedToId) where.assignedToId = assignedToId;

    // Fetch limit + 1 items to determine if there's a next page
    const tickets = await prisma.ticket.findMany({
      where,
      take: limit + 1,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      orderBy: {
        createdAt: 'desc',
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

    let nextCursor: string | undefined = undefined;
    if (tickets.length > limit) {
      tickets.pop();
      nextCursor = tickets[tickets.length - 1]?.id;
    }

    const result = {
      tickets,
      nextCursor,
    };

    // Cache the result in Redis with a 1-hour TTL
    try {
      await redis.set(cacheKey, JSON.stringify(result), 'EX', 3600);
    } catch (cacheError) {
      console.error('Redis SET error:', cacheError);
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Error fetching tickets:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

// POST /api/tickets - Create Ticket with tenant isolation and cache invalidation
export async function POST(req: NextRequest) {
  try {
    const tenantId = req.headers.get('x-tenant-id');
    const createdById = req.headers.get('x-user-id');
    
    if (!tenantId || !createdById) {
      return NextResponse.json({ error: 'Unauthorized: Auth details missing' }, { status: 401 });
    }

    const body = await req.json();
    const { title, description, priority, assignedToId } = body;

    if (!title || !description) {
      return NextResponse.json({ error: 'Title and description are required.' }, { status: 400 });
    }

    // Verify assigned user exists AND belongs to the same tenant
    if (assignedToId) {
      const userExists = await prisma.user.findUnique({
        where: { id: assignedToId },
      });
      if (!userExists || userExists.tenantId !== tenantId) {
        return NextResponse.json({ error: 'Assigned user not found in this tenant.' }, { status: 404 });
      }
    }

    const ticket = await prisma.ticket.create({
      data: {
        title,
        description,
        priority: priority || 'LOW',
        status: 'OPEN',
        assignedToId: assignedToId || null,
        createdById,
        tenantId,
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

    // Invalidate cached lists for this tenant
    await invalidateTenantTicketsCache(tenantId);

    // Publish ticket.created event to RabbitMQ
    await publishEvent('ticket.created', {
      ticketId: ticket.id,
      title: ticket.title,
      description: ticket.description,
      priority: ticket.priority,
      status: ticket.status,
      assignedToId: ticket.assignedToId,
      createdById: ticket.createdById,
      tenantId: ticket.tenantId,
      createdAt: ticket.createdAt,
    });

    return NextResponse.json(ticket, { status: 201 });
  } catch (error: any) {
    console.error('Error creating ticket:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
