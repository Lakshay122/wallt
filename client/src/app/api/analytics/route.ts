import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

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

    if (role !== 'ADMIN') {
      return NextResponse.json(
        { success: false, message: 'Forbidden: Access restricted to administrators' },
        { status: 403 }
      );
    }

    // 1. Total open, in-progress, and resolved/closed tickets (current month)
    const statusCountsRaw = await prisma.$queryRaw<Array<{ status: string; count: number }>>`
      SELECT status, COUNT(*)::int as count 
      FROM "Ticket"
      WHERE "tenantId" = ${tenantId} 
        AND "createdAt" >= DATE_TRUNC('month', NOW())
      GROUP BY status;
    `;

    // 2. Average ticket resolution time (in hours)
    const avgResolutionRaw = await prisma.$queryRaw<Array<{ avg_hours: number | null }>>`
      SELECT AVG(EXTRACT(EPOCH FROM ("updatedAt" - "createdAt")) / 3600)::double precision as avg_hours
      FROM "Ticket"
      WHERE "tenantId" = ${tenantId}
        AND status IN ('RESOLVED', 'CLOSED');
    `;

    // 3. Tickets created per day for the last 30 days
    const dailyCreationsRaw = await prisma.$queryRaw<Array<{ date: string; count: number }>>`
      SELECT TO_CHAR("createdAt", 'YYYY-MM-DD') as date, COUNT(*)::int as count
      FROM "Ticket"
      WHERE "tenantId" = ${tenantId}
        AND "createdAt" >= NOW() - INTERVAL '30 days'
      GROUP BY TO_CHAR("createdAt", 'YYYY-MM-DD')
      ORDER BY date ASC;
    `;

    // 4. Top 3 agents by tickets resolved
    const topAgentsRaw = await prisma.$queryRaw<Array<{ id: string; name: string; count: number }>>`
      SELECT u.id, u.name, COUNT(t.id)::int as count
      FROM "Ticket" t
      JOIN "User" u ON t."assignedToId" = u.id
      WHERE t."tenantId" = ${tenantId}
        AND t.status IN ('RESOLVED', 'CLOSED')
        AND t."assignedToId" IS NOT NULL
      GROUP BY u.id, u.name
      ORDER BY count DESC
      LIMIT 3;
    `;

    // Format results to be front-end friendly
    const statusCounts = {
      OPEN: 0,
      IN_PROGRESS: 0,
      RESOLVED: 0,
      CLOSED: 0,
    };
    statusCountsRaw.forEach((row) => {
      const key = row.status as keyof typeof statusCounts;
      if (key in statusCounts) {
        statusCounts[key] = row.count;
      }
    });

    const avgResolutionTime = avgResolutionRaw[0]?.avg_hours !== null ? Math.round(avgResolutionRaw[0].avg_hours * 10) / 10 : 0;

    return NextResponse.json({
      success: true,
      data: {
        statusCounts,
        avgResolutionTime,
        dailyCreations: dailyCreationsRaw,
        topAgents: topAgentsRaw,
      },
    });
  } catch (error: any) {
    console.error('Error fetching analytics:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
