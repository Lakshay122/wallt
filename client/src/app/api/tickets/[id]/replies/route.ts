import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { invalidateTenantTicketsCache, invalidateSingleTicketCache } from '@/lib/redis';
import { publishEvent } from '@/lib/rabbitmq';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/tickets/[id]/replies - Add Reply to a Ticket with tenant isolation and cache invalidation
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const tenantId = req.headers.get('x-tenant-id');
    const authUserId = req.headers.get('x-user-id');
    
    if (!tenantId || !authUserId) {
      return NextResponse.json({ error: 'Unauthorized: Auth credentials missing' }, { status: 401 });
    }

    const { id: ticketId } = await params;
    const body = await req.json();
    const { content } = body;

    if (!content) {
      return NextResponse.json({ error: 'Content is required.' }, { status: 400 });
    }

    // Verify ticket exists and belongs to the current tenant
    const ticket = await prisma.ticket.findFirst({
      where: { id: ticketId, tenantId },
    });
    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
    }

    const reply = await prisma.ticketReply.create({
      data: {
        content,
        ticketId,
        userId: authUserId,
        tenantId,
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
    });

    // Invalidate cached lists for this tenant and single ticket cache
    await invalidateTenantTicketsCache(tenantId);
    await invalidateSingleTicketCache(tenantId, ticketId);

    // Publish reply.created event to RabbitMQ for real-time WebSocket updates
    await publishEvent('reply.created', {
      replyId: reply.id,
      ticketId: reply.ticketId,
      content: reply.content,
      userId: reply.userId,
      user: reply.user,
      tenantId: reply.tenantId,
      createdAt: reply.createdAt,
    });

    return NextResponse.json(reply, { status: 201 });
  } catch (error: any) {
    console.error('Error creating reply:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
