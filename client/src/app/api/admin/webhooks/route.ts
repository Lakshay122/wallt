import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import crypto from 'crypto';

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

    const config = await prisma.webhookConfig.findUnique({
      where: { tenantId },
      select: {
        id: true,
        url: true,
        isActive: true,
        secret: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ success: true, data: config });
  } catch (error: any) {
    console.error('Error fetching webhook config:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}

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

    if (role !== 'ADMIN') {
      return NextResponse.json(
        { success: false, message: 'Forbidden: Access restricted to administrators' },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { url, isActive } = body;

    if (!url) {
      return NextResponse.json(
        { success: false, message: 'Missing endpoint URL' },
        { status: 400 }
      );
    }

    // Retrieve existing secret or generate a new random 32-byte hex secret
    let secret = '';
    const existing = await prisma.webhookConfig.findUnique({
      where: { tenantId },
    });

    if (existing) {
      secret = existing.secret;
    } else {
      secret = crypto.randomBytes(32).toString('hex');
    }

    const config = await prisma.webhookConfig.upsert({
      where: { tenantId },
      create: {
        tenantId,
        url,
        isActive: isActive ?? true,
        secret,
      },
      update: {
        url,
        isActive: isActive ?? true,
      },
      select: {
        id: true,
        url: true,
        isActive: true,
        secret: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ success: true, data: config });
  } catch (error: any) {
    console.error('Error updating webhook config:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
