import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const userId = req.headers.get('x-user-id');
    const tenantId = req.headers.get('x-tenant-id');

    if (!userId || !tenantId) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized: Auth details missing' },
        { status: 401 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        tenant: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!user || user.tenant.id !== tenantId) {
      return NextResponse.json(
        { success: false, message: 'User not found or tenant mismatch' },
        { status: 404 }
      );
    }

    const accessToken = req.cookies.get('accessToken')?.value;

    return NextResponse.json({ success: true, data: user, token: accessToken });
  } catch (error: any) {
    console.error('Error fetching current user:', error);
    return NextResponse.json(
      { success: false, message: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
