import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET /api/admin/failed-notifications - Fetch DLQ/failed notifications for the tenant
export async function GET(req: NextRequest) {
  try {
    const tenantId = req.headers.get('x-tenant-id');
    const userRole = req.headers.get('x-user-role');

    if (!tenantId) {
      return NextResponse.json({ error: 'Unauthorized: Tenant missing' }, { status: 401 });
    }

    if (userRole !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const cursor = searchParams.get('cursor') || '';

    const failedNotifications = await prisma.failedNotification.findMany({
      where: {
        tenantId: tenantId,
      },
      take: limit + 1,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      orderBy: {
        createdAt: 'desc',
      },
    });

    let nextCursor: string | undefined = undefined;
    if (failedNotifications.length > limit) {
      const nextItem = failedNotifications.pop();
      nextCursor = nextItem?.id;
    }

    return NextResponse.json({
      success: true,
      data: failedNotifications,
      nextCursor,
    });
  } catch (error: any) {
    console.error('Error fetching failed notifications:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
