import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { signAccessToken, signRefreshToken } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json({ error: 'Missing email or password' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: { tenant: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    if (user.isActive === false) {
      return NextResponse.json({ error: 'User account is inactive. Please contact your administrator.' }, { status: 403 });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    const payload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    };

    const accessToken = await signAccessToken(payload);
    const refreshToken = await signRefreshToken(payload);

    const response = NextResponse.json({
      message: 'Login successful',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        tenant: {
          id: user.tenant.id,
          name: user.tenant.name,
        },
      },
    });

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
    console.error('Login error:', error);
    return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 });
  }
}
