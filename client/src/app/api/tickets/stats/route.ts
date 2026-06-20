import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { redis } from '@/lib/redis';

export async function GET(req: NextRequest) {
  try {
    const tenantId = req.headers.get('x-tenant-id');
    if (!tenantId) {
      return NextResponse.json({ error: 'Unauthorized: Tenant missing' }, { status: 401 });
    }

    const cacheKey = `tenant:${tenantId}:tickets:stats`;

    // Try fetching from Redis cache first
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return NextResponse.json(JSON.parse(cached));
      }
    } catch (cacheError) {
      console.error('Redis GET stats cache error:', cacheError);
    }

    const [total, open, highPriority, resolved] = await Promise.all([
      prisma.ticket.count({ where: { tenantId } }),
      prisma.ticket.count({ where: { tenantId, status: 'OPEN' } }),
      prisma.ticket.count({ where: { tenantId, priority: 'HIGH' } }),
      prisma.ticket.count({ where: { tenantId, status: 'RESOLVED' } }),
    ]);

    const stats = {
      total,
      open,
      highPriority,
      resolved,
    };

    // Cache the result for 5 minutes
    try {
      await redis.set(cacheKey, JSON.stringify(stats), 'EX', 300);
    } catch (cacheError) {
      console.error('Redis SET stats cache error:', cacheError);
    }

    return NextResponse.json(stats);
  } catch (error: any) {
    console.error('Error fetching ticket stats:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
