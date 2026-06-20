import { NextRequest, NextResponse } from 'next/server';
import { UserService } from '@/lib/services/user.service';
import { invalidateTenantTeamCache } from '@/lib/redis';

const userService = new UserService();

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const tenantId = req.headers.get('x-tenant-id');
    const role = req.headers.get('x-user-role');

    if (!tenantId || !role) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized: Auth details missing' },
        { status: 401 }
      );
    }

    const { id } = await params;
    const currentUser = { tenantId, role };
    const body = await req.json();

    const result = await userService.updateAgentStatus(id, body, currentUser);
    if (!result.success) {
      let status = 400;
      if (result.message.includes('Forbidden')) {
        status = 403;
      } else if (result.message.includes('not found')) {
        status = 404;
      }
      return NextResponse.json(result, { status });
    }

    // Invalidate cached team list on status change
    await invalidateTenantTeamCache(tenantId);

    return NextResponse.json(result, { status: 200 });
  } catch (error: any) {
    console.error('Error updating agent status:', error);
    return NextResponse.json(
      { success: false, message: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
