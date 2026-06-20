import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { signAccessToken, signRefreshToken } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { tenantName, name, email, password, tenantDescription, tenantType } = body;

    if (!tenantName || !name || !email || !password) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Check if user already exists globally
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json({ error: 'User with this email already exists' }, { status: 400 });
    }

    // Hash the password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create Tenant and Admin User in a transaction
    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { 
          name: tenantName,
          description: tenantDescription || null,
          type: tenantType || null
        },
      });

      const user = await tx.user.create({
        data: {
          email,
          name,
          password: passwordHash,
          role: 'ADMIN',
          tenantId: tenant.id,
        },
      });

      return { tenant, user };
    });

    const payload = {
      userId: result.user.id,
      email: result.user.email,
      role: result.user.role,
      tenantId: result.tenant.id,
    };

    const accessToken = await signAccessToken(payload);
    const refreshToken = await signRefreshToken(payload);

    const response = NextResponse.json({
      message: 'Signup successful',
      user: {
        id: result.user.id,
        name: result.user.name,
        email: result.user.email,
        role: result.user.role,
        tenant: {
          id: result.tenant.id,
          name: result.tenant.name,
        },
      },
    });

    // Set cookies
    const accessMaxAge = parseInt(process.env.JWT_ACCESS_MAX_AGE || '900', 10);
    const refreshMaxAge = parseInt(process.env.JWT_REFRESH_MAX_AGE || '604800', 10);
    const isProduction = process.env.NODE_ENV === 'production';
    
    response.cookies.set({
      name: 'accessToken',
      value: accessToken,
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict',
      maxAge: accessMaxAge,
      path: '/',
    });

    response.cookies.set({
      name: 'refreshToken',
      value: refreshToken,
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict',
      maxAge: refreshMaxAge,
      path: '/',
    });

    return response;
  } catch (error: any) {
    console.error('Signup error:', error);
    return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 });
  }
}
