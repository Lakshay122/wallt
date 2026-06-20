import { NextRequest, NextResponse } from 'next/server';
import { UserService } from '@/lib/services/user.service';
import { redis, invalidateTenantTeamCache } from '@/lib/redis';
import { publishEvent } from '@/lib/rabbitmq';

const userService = new UserService();

export async function POST(req: NextRequest) {
  try {
    const tenantId = req.headers.get('x-tenant-id');
    const role = req.headers.get('x-user-role');

    if (!tenantId || !role) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized: Auth details missing' },
        { status: 401 }
      );
    }

    const currentUser = { tenantId, role };
    const body = await req.json();

    const result = await userService.createAgent(body, currentUser);
    if (!result.success) {
      const status = result.message.includes('Forbidden') ? 403 : 400;
      return NextResponse.json(result, { status });
    }

    // Invalidate cached team list on creation
    await invalidateTenantTeamCache(tenantId);

    // Publish agent.invited event to RabbitMQ
    if (result.data && 'id' in result.data) {
      await publishEvent('agent.invited', {
        userId: (result.data as any).id,
        email: (result.data as any).email,
        name: (result.data as any).name,
        role: (result.data as any).role,
        tenantId: (result.data as any).tenantId,
      });
    }

    return NextResponse.json(result, { status: 201 });
  } catch (error: any) {
    console.error('Error creating agent:', error);
    return NextResponse.json(
      { success: false, message: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const tenantId = req.headers.get('x-tenant-id');
    const role = req.headers.get('x-user-role');

    if (!tenantId || !role) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized: Auth details missing' },
        { status: 401 }
      );
    }

    if (role !== 'ADMIN' && role !== 'AGENT') {
      return NextResponse.json(
        { success: false, message: 'Forbidden: Only ADMIN and AGENT users can view team members' },
        { status: 403 }
      );
    }

    const cacheKey = `tenant:${tenantId}:team:list`;

    // Try fetching from Redis
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return NextResponse.json(JSON.parse(cached));
      }
    } catch (cacheError) {
      console.error('Redis GET team cache error:', cacheError);
    }

    const currentUser = { tenantId, role };
    const result = await userService.getTeamMembers(currentUser);
    if (!result.success) {
      const status = result.message.includes('Forbidden') ? 403 : 400;
      return NextResponse.json(result, { status });
    }

    // Cache the successful result in Redis with 1-hour TTL
    try {
      await redis.set(cacheKey, JSON.stringify(result), 'EX', 3600);
    } catch (cacheError) {
      console.error('Redis SET team cache error:', cacheError);
    }

    return NextResponse.json(result, { status: 200 });
  } catch (error: any) {
    console.error('Error fetching team members:', error);
    return NextResponse.json(
      { success: false, message: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
